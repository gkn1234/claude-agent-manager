# Architecture of Tasks

## 1. Identity

- **What it is:** The task subsystem that models units of work within a project, providing git worktree isolation and a manual-trigger initialization pipeline (pending -> init -> research -> ready).
- **Purpose:** Enables parallel, isolated AI agent work on the same codebase by mapping each task to a dedicated git worktree, running automated research before accepting user commands.

## 2. Core Components

- `src/lib/schema.ts` (`tasks`, `commands`, `tasksRelations`): Defines the tasks and commands tables. Tasks hold worktree metadata, `lastProviderId`, `lastMode`; commands hold execution state including `providerId` and `execEnv`. One-to-many: project -> tasks -> commands.
- `src/app/api/projects/[id]/tasks/route.ts` (`POST`): Creates a task in `pending` status. No init command is auto-generated at creation time.
- `src/app/api/tasks/[id]/init/route.ts` (`POST`): Manual init trigger. Requires `providerId`. Transitions task `pending -> initializing`, creates `mode='init'` command with provider.
- `src/app/api/tasks/route.ts` (`GET`): Lists tasks, supports `?project_id=` filtering.
- `src/app/api/tasks/[id]/route.ts` (`GET`, `PATCH`, `DELETE`): Retrieves task with commands; updates `lastProviderId`/`lastMode` preferences; deletes task via `cleanupTask()`.
- `src/app/api/tasks/[id]/commands/route.ts` (`POST`): Adds a command to a task. Requires `providerId`. Rejects with 403 if task status is not `ready`; rejects with 409 if a running command exists.
- `src/lib/scheduler.ts` (`tick`): Polls queued commands. Enforces per-task serial execution by skipping tasks that have a running command.
- `src/lib/claude-runner.ts` (`runCommand`, `cleanupTask`): Spawns `claude` CLI in the task's `worktreeDir` with provider env injection. On init success: scans for worktree dir (creation-time sorted, excludes dirs assigned to other tasks), sets status to `researching`, creates research command. On research success: promotes task to `ready`. `cleanupTask` handles full cleanup (kill processes, delete logs, remove worktree, delete DB records).
- `src/lib/config.ts` (`getConfig`, `CONFIG_DEFAULTS`): Provides `init_prompt` and `research_prompt` templates with placeholder substitution.

## 3. Execution Flow (LLM Retrieval Map)

### Task Creation

- **1. API Request:** `POST /api/projects/{id}/tasks` with `{ description }` -- `src/app/api/projects/[id]/tasks/route.ts:7-25`.
- **2. Task Insert:** Inserts task row with `status='pending'` -- `src/app/api/projects/[id]/tasks/route.ts:16-21`. No init command created yet.

### Manual Init Trigger

- **3. API Request:** `POST /api/tasks/{id}/init` with `{ providerId }` -- `src/app/api/tasks/[id]/init/route.ts:8-51`.
- **4. Validation:** Rejects if task is not `pending` (409), provider not found (404).
- **5. Status Update:** Sets task `status='initializing'`, `lastProviderId` -- `src/app/api/tasks/[id]/init/route.ts:27-31`.
- **6. Init Command:** Reads `init_prompt` template, substitutes `{workDir}` and `{description}`, creates command with `mode='init'`, `status='queued'`, `priority=10`, `providerId` -- `src/app/api/tasks/[id]/init/route.ts:34-48`.

### Two-Phase Initialization Pipeline

- **7. Init Execution:** Scheduler picks up the init command. Runner spawns `claude` CLI with provider env vars injected -- `src/lib/claude-runner.ts:55-156`.
- **8. Worktree Detection:** On exit code 0 with `mode='init'`: scans `.worktrees/` for newest directory by creation time (`birthtimeMs`), excludes directories already assigned to other tasks -- `src/lib/claude-runner.ts:239-261`.
- **9. Research Command Auto-Creation:** Creates a `mode='research'` command (plan mode) using `research_prompt` template, inheriting `providerId` from init command -- `src/lib/claude-runner.ts:271-283`.
- **10. Task Ready:** On research command exit code 0: task status updated to `ready` -- `src/lib/claude-runner.ts:288-292`.

### Adding Commands to a Task

- **1. API Request:** `POST /api/tasks/{id}/commands` with `{ prompt, mode?, autoQueue?, providerId }` -- `src/app/api/tasks/[id]/commands/route.ts:7-40`.
- **2. Status Gate:** Rejects with 403 if `task.status !== 'ready'`.
- **3. Provider Required:** Rejects with 400 if no `providerId` provided.
- **4. Conflict Check:** Rejects with 409 if a command with `status='running'` exists.

### Task Deletion (Cleanup)

- **1. API Request:** `DELETE /api/tasks/{id}` -- `src/app/api/tasks/[id]/route.ts:31-38`.
- **2. `cleanupTask()`:** `src/lib/claude-runner.ts:23-53` performs: kill running processes (SIGTERM+SIGKILL), delete log files, remove git worktree (`git worktree remove --force`), delete commands and task DB records.

### Task State Machine

```
pending → initializing → researching → ready
```

- `pending`: Task created, awaiting manual init trigger. Provider select + init button shown in UI.
- `initializing`: Init command is queued/running. Progress indicator shown.
- `researching`: Init completed, research command is queued/running. Progress indicator shown.
- `ready`: Research completed. Provider select + Plan/Exec toggle + command input shown.

## 4. Design Rationale

- **Manual init trigger** allows users to choose a provider profile before initialization begins, rather than auto-starting with a default.
- **Two-phase initialization** separates environment setup (init) from codebase analysis (research), ensuring the agent has full context before accepting work.
- **Worktree detection by creation time** with exclusion of already-assigned directories prevents misattribution when multiple tasks init concurrently.
- **`cleanupTask()` centralization** ensures consistent cleanup logic shared between task DELETE and project DELETE (cascade).
- **Provider inheritance** from init to research command ensures the same API credentials are used throughout initialization.
