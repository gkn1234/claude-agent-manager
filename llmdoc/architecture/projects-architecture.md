# Architecture of Projects

## 1. Identity

- **What it is:** The top-level entity representing a git repository managed by the system.
- **Purpose:** Provides workspace isolation for tasks and commands; each project maps to a filesystem directory with git capabilities.

## 2. Core Components

- `src/lib/schema.ts` (`projects`, `projectsRelations`): Defines the `projects` table (id, name, work_dir, git_remote, created_at, updated_at) and its one-to-many relation to `tasks`.
- `src/app/api/projects/route.ts` (`GET`, `POST`): Lists all projects and handles creation in three modes (clone, new, local).
- `src/app/api/projects/[id]/route.ts` (`GET`, `DELETE`): Retrieves a single project with its tasks, or cascade-deletes a project.
- `src/lib/utils/git.ts` (`isGitRepo`, `gitClone`, `gitInit`, `getGitRemote`, `ensureGitignoreEntry`): Git CLI wrappers using `execFileSync` (no shell injection risk). Called during project creation.

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

### 3b. Project Retrieval (GET /api/projects)

- **1. Query:** `src/app/api/projects/route.ts:17-19` - `db.select().from(projects).all()` returns all projects.

### 3c. Single Project Retrieval (GET /api/projects/[id])

- **1. Query project:** `src/app/api/projects/[id]/route.ts:7-8` - Finds project by ID or returns 404.
- **2. Query tasks:** `src/app/api/projects/[id]/route.ts:11` - Fetches all tasks for this project.
- **3. Response:** Returns merged `{ ...project, tasks }`.

### 3d. Project Deletion (DELETE /api/projects/[id])

- **1. Lookup:** `src/app/api/projects/[id]/route.ts:17-18` - Find project or 404.
- **2. Cascade delete commands:** `src/app/api/projects/[id]/route.ts:20-23` - For each task in the project, delete all its commands.
- **3. Delete tasks:** `src/app/api/projects/[id]/route.ts:24` - Delete all tasks for the project.
- **4. Delete project:** `src/app/api/projects/[id]/route.ts:25` - Delete the project row itself.
- **Note:** Deletion does NOT remove the filesystem directory or git worktrees. Only database records are removed.

## 4. Design Rationale

- **Three creation modes** allow flexibility: `clone` for existing remote repos, `new` for greenfield projects, `local` for pre-existing local repos.
- **`.worktrees/` in gitignore** is added universally because tasks create git worktrees under the project directory for workspace isolation.
- **`execFileSync`** is used for all git operations (not `exec` with shell strings) to prevent command injection.
- **Cascade deletion order** (commands -> tasks -> project) respects foreign key constraints without relying on database-level CASCADE.
