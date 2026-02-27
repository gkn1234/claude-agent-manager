# How to Work with Tasks

A task represents an isolated unit of work within a project. Each task gets its own git worktree and executes commands serially.

## Task Lifecycle

1. **Create a task:** `POST /api/projects/{projectId}/tasks` with `{ "description": "..." }`. The system automatically creates the task (`status=initializing`) and inserts an init command (`status=queued`, `priority=10`). See `src/app/api/projects/[id]/tasks/route.ts`.

2. **Init command runs automatically:** The scheduler picks up the queued init command and spawns a Claude process. Claude creates a git worktree at `{project.workDir}/.worktrees/` with branch `task/{short-id}`, then analyzes the project. On success, task status becomes `ready`. See `src/lib/claude-runner.ts:151-158`.

3. **Add follow-up commands:** `POST /api/tasks/{taskId}/commands` with `{ "prompt": "...", "mode": "execute"|"plan" }`. Commands execute serially -- the API rejects requests if a command is already running (409). See `src/app/api/tasks/[id]/commands/route.ts`.

4. **Monitor task state:** `GET /api/tasks/{taskId}` returns the task with all its commands. The frontend task page (`src/app/tasks/[id]/page.tsx`) polls every 5 seconds.

5. **Delete a task:** `DELETE /api/tasks/{taskId}` cleans up the git worktree (`git worktree remove --force`) and cascade-deletes all commands. See `src/app/api/tasks/[id]/route.ts:17-34`.

## Key Concepts

- **Worktree isolation:** Each task operates in its own git worktree under `.worktrees/`. This directory is auto-added to `.gitignore` on project creation. Multiple tasks can work on the same repo in parallel without conflicts.
- **Serial command execution:** Within a single task, only one command can be `running` at a time. The scheduler (`src/lib/scheduler.ts:43-49`) enforces this by skipping tasks that already have a running command.
- **Session continuity:** Commands within the same task automatically resume the previous Claude session via `--resume {sessionId}`, enabling multi-turn context. See `src/lib/claude-runner.ts:58-68`.
- **Task splitting via MCP:** The init command prompt instructs Claude to use the `create_task` MCP tool if the task is too large, enabling recursive decomposition. See `src/mcp-server-stdio.ts`.

## Task Statuses

| Status | Meaning |
|---|---|
| `initializing` | Task created, init command queued but not yet completed |
| `ready` | Init command succeeded, worktree is set up, task accepts new commands |

## Verifying Task Setup

After creating a task, confirm the init command completed successfully by checking:
- Task status is `ready` via `GET /api/tasks/{taskId}`
- The `worktreeDir` field is populated on the task record
- The worktree directory exists on disk at `{project.workDir}/.worktrees/task-{short-id}`
