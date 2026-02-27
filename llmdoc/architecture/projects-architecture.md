# Architecture of Projects

## 1. Identity

- **What it is:** The top-level entity representing a git repository managed by the system.
- **Purpose:** Provides workspace isolation for tasks and commands; each project maps to a filesystem directory with git capabilities.

## 2. Core Components

- `src/lib/schema.ts` (`projects`, `projectsRelations`): Defines the `projects` table (id, name, work_dir, git_remote, created_at, updated_at) and its one-to-many relation to `tasks`.
- `src/app/api/projects/route.ts` (`GET`, `POST`): Lists all projects and handles creation in three modes (clone, new, local).
- `src/app/api/projects/[id]/route.ts` (`GET`, `DELETE`): Retrieves a single project with its tasks, or cascade-deletes a project via `cleanupTask()` for each task.
- `src/lib/utils/git.ts` (`isGitRepo`, `gitClone`, `gitInit`, `getGitRemote`, `ensureGitignoreEntry`): Git CLI wrappers using `execFileSync` (no shell injection risk). Called during project creation.
- `src/lib/claude-runner.ts` (`cleanupTask`): Used by project DELETE to clean up each task (kill processes, delete logs, remove worktrees, delete DB records).

## 3. Execution Flow (LLM Retrieval Map)

### 3a. Project Creation (POST /api/projects)

- **1. Request parsing:** `src/app/api/projects/route.ts:22-24` - Extracts `{ name, workDir, gitUrl, mode }` from JSON body.
- **2. Directory resolution:** `src/app/api/projects/route.ts:12-15` (`resolveProjectDir`) - If no `workDir` provided, defaults to `~/claude-agent-manager/<name>`.
- **3. Mode-specific git operations:**
  - **clone** (`src/app/api/projects/route.ts:32-56`): Requires `gitUrl`. If directory exists and is the same repo, reuses it; otherwise 409. If directory absent, calls `gitClone(gitUrl, finalDir)`.
  - **new** (`src/app/api/projects/route.ts:57-68`): Creates directory with `mkdirSync`, then `gitInit(finalDir)`. Directory must not exist (409).
  - **local** (`src/app/api/projects/route.ts:69-78`): Uses existing `workDir` as-is. Must exist and be a git repo (400 otherwise).
- **4. Gitignore setup:** `src/app/api/projects/route.ts:80` - All modes call `ensureGitignoreEntry(finalDir, '.worktrees/')`.
- **5. Database insert:** `src/app/api/projects/route.ts:82-85` - Generates UUID, reads git remote, inserts row into `projects` table. Returns 201.

### 3b. Project Deletion (DELETE /api/projects/[id])

- **1. Lookup:** `src/app/api/projects/[id]/route.ts:17-19` - Find project or 404.
- **2. Cascade cleanup:** `src/app/api/projects/[id]/route.ts:21-24` - For each task, calls `cleanupTask(task.id)` which kills running processes, deletes log files, removes git worktrees, and deletes commands + task DB records.
- **3. Delete project:** `src/app/api/projects/[id]/route.ts:25` - Delete the project row itself.

## 4. Design Rationale

- **Three creation modes** allow flexibility: `clone` for existing remote repos, `new` for greenfield projects, `local` for pre-existing local repos.
- **`.worktrees/` in gitignore** is added universally because tasks create git worktrees under the project directory for workspace isolation.
- **`cleanupTask()` for cascade delete** ensures running processes are killed and worktrees are removed, not just DB records.
- **`execFileSync`** is used for all git operations (not `exec` with shell strings) to prevent command injection.
