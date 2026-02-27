# Architecture of Tasks

## 1. Identity

- **What it is:** The task subsystem that models units of work within a project, providing git worktree isolation and a two-phase initialization pipeline (init -> research -> ready).
- **Purpose:** Enables parallel, isolated AI agent work on the same codebase by mapping each task to a dedicated git worktree, running automated research before accepting user commands.

## 2. Core Components

- `src/lib/schema.ts` (`tasks`, `commands`, `tasksRelations`): Defines the tasks and commands tables. Tasks hold worktree metadata; commands hold execution state. One-to-many: project -> tasks -> commands.
- `src/app/api/projects/[id]/tasks/route.ts` (`POST`): Creates a task and auto-generates a `mode='init'` command using a configurable init prompt template.
- `src/app/api/tasks/route.ts` (`GET`): Lists tasks, supports `?project_id=` filtering.
- `src/app/api/tasks/[id]/route.ts` (`GET`, `DELETE`): Retrieves task with commands; deletes task with worktree cleanup via `git worktree remove --force`.
- `src/app/api/tasks/[id]/commands/route.ts` (`POST`): Adds a command to a task. Rejects with 403 if task status is not `ready`; rejects with 409 if a running command exists.
- `src/lib/scheduler.ts` (`tick`): Polls queued commands. Enforces per-task serial execution by skipping tasks that have a running command.
- `src/lib/claude-runner.ts` (`runCommand`): Spawns `claude` CLI in the task's `worktreeDir`. On init success: scans for worktree dir, sets status to `researching`, creates research command. On research success: promotes task to `ready`.
- `src/lib/config.ts` (`getConfig`, `CONFIG_DEFAULTS`): Provides `init_prompt` and `research_prompt` templates with placeholder substitution.

## 3. Execution Flow (LLM Retrieval Map)

### Task Creation

- **1. API Request:** `POST /api/projects/{id}/tasks` with `{ description }` -- `src/app/api/projects/[id]/tasks/route.ts:8-42`.
- **2. Task Insert:** Inserts task row with `status='initializing'` -- `src/app/api/projects/[id]/tasks/route.ts:17-22`.
- **3. Init Command:** Reads `init_prompt` template from config, substitutes `{workDir}` and `{description}`, creates command with `mode='init'`, `status='queued'`, `priority=10` -- `src/app/api/projects/[id]/tasks/route.ts:25-38`.

### Two-Phase Initialization Pipeline

- **4. Init Execution:** Scheduler picks up the init command. Runner spawns `claude` CLI. Init prompt instructs Claude to check `.gitignore`, create worktree, choose branch name autonomously -- `src/lib/claude-runner.ts:20-95`.
- **5. Init Post-Processing:** On exit code 0 with `mode='init'`: scans `.worktrees/` for newest directory, updates task `worktreeDir` and `status='researching'` -- `src/lib/claude-runner.ts:152-176`.
- **6. Research Command Auto-Creation:** Creates a `mode='research'` command (plan mode) using `research_prompt` template with `{description}` substitution -- `src/lib/claude-runner.ts:179-190`.
- **7. Research Execution:** Scheduler picks up research command. Runs with `--plan` flag (plan mode). Claude analyzes the codebase and task requirements.
- **8. Task Ready:** On research command exit code 0: task status updated to `ready` -- `src/lib/claude-runner.ts:195-200`.

### Adding Commands to a Task

- **1. API Request:** `POST /api/tasks/{id}/commands` with `{ prompt, mode?, autoQueue? }` -- `src/app/api/tasks/[id]/commands/route.ts:7-38`.
- **2. Status Gate:** Rejects with 403 if `task.status !== 'ready'` (blocks commands during init/research) -- `src/app/api/tasks/[id]/commands/route.ts:12-15`.
- **3. Conflict Check:** Rejects with 409 if a command with `status='running'` exists -- `src/app/api/tasks/[id]/commands/route.ts:17-21`.

### Session Isolation

- Session resumption (`--resume`) skips commands with `mode='init'` or `mode='research'` to prevent polluting user command sessions -- `src/lib/claude-runner.ts:59-65`.

### Task Deletion

- **1. API Request:** `DELETE /api/tasks/{id}` -- `src/app/api/tasks/[id]/route.ts`.
- **2. Worktree Cleanup:** If `task.worktreeDir` exists on disk, runs `git worktree remove --force`.
- **3. Cascade Delete:** Deletes all commands for the task, then the task itself.

### Task State Machine

```
initializing → researching → ready
```

- `initializing`: Init command is queued/running. No user commands allowed.
- `researching`: Init completed, research command is queued/running. No user commands allowed.
- `ready`: Research completed. User commands accepted.

## 4. Design Rationale

- **Two-phase initialization** separates environment setup (init) from codebase analysis (research), ensuring the agent has full context before accepting work.
- **Session isolation** keeps init/research sessions separate from user command sessions, preventing context pollution.
- **Configurable prompts** (`init_prompt`, `research_prompt`) allow operators to customize initialization behavior without code changes.
- **API gating on `ready` status** prevents premature command submission, ensuring tasks are fully initialized.
- **Branch naming delegation** to LLM (instead of fixed `task/{id}` pattern) produces more meaningful branch names aligned with project conventions.
