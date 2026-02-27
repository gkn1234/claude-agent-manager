# How to Work with Tasks

A task represents an isolated unit of work within a project. Each task gets its own git worktree and executes commands serially.

## Task Lifecycle

1. **Create a task:** `POST /api/projects/{projectId}/tasks` with `{ "description": "..." }`. The task is created with `status=pending`. No initialization happens yet. See `src/app/api/projects/[id]/tasks/route.ts`.

2. **Initialize the task:** `POST /api/tasks/{taskId}/init` with `{ "providerId": "..." }`. This transitions the task to `initializing` and creates an init command with the chosen provider. The scheduler picks it up and spawns a Claude process that creates a git worktree. See `src/app/api/tasks/[id]/init/route.ts`.

3. **Wait for two-phase init:** After init succeeds, the task automatically transitions to `researching` and a research command is created (inheriting the provider). After research succeeds, task becomes `ready`. See `src/lib/claude-runner.ts:232-293`.

4. **Add follow-up commands:** `POST /api/tasks/{taskId}/commands` with `{ "prompt": "...", "mode": "execute"|"plan", "providerId": "..." }`. Provider is required. Commands execute serially -- the API rejects requests if a command is already running (409). See `src/app/api/tasks/[id]/commands/route.ts`.

5. **Monitor task state:** `GET /api/tasks/{taskId}` returns the task with all its commands. The frontend task page (`src/app/tasks/[id]/page.tsx`) polls every 5 seconds.

6. **Delete a task:** `DELETE /api/tasks/{taskId}` calls `cleanupTask()` which kills running processes, deletes log files, removes the git worktree, and cascade-deletes all DB records. See `src/lib/claude-runner.ts:23-53`.

## Key Concepts

- **Worktree isolation:** Each task operates in its own git worktree under `.worktrees/`. Multiple tasks can work on the same repo in parallel without conflicts.
- **Serial command execution:** Within a single task, only one command can be `running` at a time. The scheduler enforces this by skipping tasks that already have a running command.
- **Session continuity:** Commands within the same task automatically resume the previous Claude session via `--resume {sessionId}`, skipping init/research sessions.
- **Provider required:** Every command (init, research, user) must have an associated provider. No default fallback exists.
- **Preference persistence:** The task page saves `lastProviderId` and `lastMode` via `PATCH /api/tasks/{id}`, restoring them on reload.

## Task Statuses

| Status | Meaning |
|---|---|
| `pending` | Task created, awaiting manual init trigger (UI shows provider select + init button) |
| `initializing` | Init command queued/running (UI shows progress indicator) |
| `researching` | Init completed, research command queued/running (UI shows progress indicator) |
| `ready` | Research completed, task accepts new commands (UI shows provider select + Plan/Exec toggle + command input) |

## Verifying Task Setup

After initializing a task, confirm completion by checking:
- Task status is `ready` via `GET /api/tasks/{taskId}`
- The `worktreeDir` field is populated on the task record
- The worktree directory exists on disk
