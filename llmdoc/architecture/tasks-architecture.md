# Architecture of Tasks

## 1. Identity

- **What it is:** The task subsystem that models units of work within a project, providing git worktree isolation and serial command execution.
- **Purpose:** Enables parallel, isolated AI agent work on the same codebase by mapping each task to a dedicated git worktree and orchestrating commands sequentially within it.

## 2. Core Components

- `src/lib/schema.ts` (`tasks`, `commands`, `tasksRelations`): Defines the tasks and commands tables. Tasks hold worktree metadata; commands hold execution state. One-to-many: project -> tasks -> commands.
- `src/app/api/projects/[id]/tasks/route.ts` (`POST`): Creates a task and auto-generates an init command that instructs Claude to set up a git worktree.
- `src/app/api/tasks/route.ts` (`GET`): Lists tasks, supports `?project_id=` filtering.
- `src/app/api/tasks/[id]/route.ts` (`GET`, `DELETE`): Retrieves task with commands; deletes task with worktree cleanup via `git worktree remove --force`.
- `src/app/api/tasks/[id]/commands/route.ts` (`POST`): Adds a command to a task. Rejects if the task already has a running command (409).
- `src/lib/scheduler.ts` (`tick`): Polls queued commands. Enforces per-task serial execution by skipping tasks that have a running command.
- `src/lib/claude-runner.ts` (`runCommand`): Spawns `claude` CLI in the task's `worktreeDir` (falls back to project `workDir`). On init command success, promotes task status to `ready`.
- `src/app/api/projects/route.ts` (`POST`): On project creation, calls `ensureGitignoreEntry(finalDir, '.worktrees/')` to exclude worktree dirs from git.

## 3. Execution Flow (LLM Retrieval Map)

### Task Creation

- **1. API Request:** `POST /api/projects/{id}/tasks` with `{ description }` -- `src/app/api/projects/[id]/tasks/route.ts:7-45`.
- **2. Task Insert:** Inserts task row with `status='initializing'` -- `src/app/api/projects/[id]/tasks/route.ts:16-21`.
- **3. Init Command:** Auto-creates a command (`status='queued'`, `priority=10`) whose prompt instructs Claude to create a git worktree at `{project.workDir}/.worktrees/` with branch `task/{taskId.slice(0,8)}` -- `src/app/api/projects/[id]/tasks/route.ts:24-41`.
- **4. Scheduler Pickup:** `tick()` finds the queued init command, verifies no other command is running for this task, then calls `runCommand()` -- `src/lib/scheduler.ts:29-54`.
- **5. Execution:** `runCommand()` spawns `claude` CLI in the task's working directory. Claude creates the worktree and analyzes the project -- `src/lib/claude-runner.ts:18-84`.
- **6. Task Ready:** On successful exit (code 0), if the command prompt contains the worktree creation marker, task status is updated to `ready` -- `src/lib/claude-runner.ts:151-158`.

### Adding Commands to a Task

- **1. API Request:** `POST /api/tasks/{id}/commands` with `{ prompt, mode?, autoQueue? }` -- `src/app/api/tasks/[id]/commands/route.ts:7-33`.
- **2. Conflict Check:** Rejects with 409 if a command with `status='running'` exists for this task -- `src/app/api/tasks/[id]/commands/route.ts:12-16`.
- **3. Serial Execution:** Scheduler's `tick()` also enforces this: skips queued commands whose task already has a running command -- `src/lib/scheduler.ts:43-49`.

### Task Deletion

- **1. API Request:** `DELETE /api/tasks/{id}` -- `src/app/api/tasks/[id]/route.ts:17-34`.
- **2. Worktree Cleanup:** If `task.worktreeDir` exists on disk, runs `git worktree remove --force` -- `src/app/api/tasks/[id]/route.ts:22-28`.
- **3. Cascade Delete:** Deletes all commands for the task, then the task itself -- `src/app/api/tasks/[id]/route.ts:30-31`.

### Git Worktree Isolation Pattern

- Each project's `.gitignore` includes `.worktrees/` (added on project creation) -- `src/app/api/projects/route.ts:80`.
- The init command prompt instructs Claude to create worktrees under `{project.workDir}/.worktrees/` with branch naming `task/{short-id}`.
- `runCommand()` uses `task.worktreeDir` as the `cwd` for the spawned process, falling back to `project.workDir` -- `src/lib/claude-runner.ts:30`.
- Session continuity: subsequent commands in the same task resume the previous Claude session via `--resume {sessionId}` -- `src/lib/claude-runner.ts:58-68`.

## 4. Design Rationale

- **Per-task serial execution** prevents git conflicts within a single worktree. Multiple tasks can run in parallel across different worktrees.
- **Auto-generated init command** ensures every task bootstraps its own isolated workspace without manual intervention.
- **Worktree over branch checkout** allows multiple tasks on the same repo to operate simultaneously without blocking each other.
