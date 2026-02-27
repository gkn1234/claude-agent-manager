# Architecture of Commands & Scheduler

## 1. Identity

- **What it is:** The command execution pipeline that queues, schedules, and runs Claude CLI subprocesses against project worktrees.
- **Purpose:** Provides priority-based, concurrency-controlled dispatch of AI agent commands with full lifecycle management, including automated post-processing for init and research commands.

## 2. Core Components

- `src/lib/schema.ts` (`commands`): Defines the `commands` SQLite table -- id, taskId, prompt, mode, status, priority, result, logFile, sessionId, pid, startedAt, finishedAt, createdAt.
- `src/lib/scheduler.ts` (`startScheduler`, `stopScheduler`, `tick`, `recoverOrphanedCommands`): Polling-based scheduler. Reads queued commands from DB each tick, enforces per-task serial execution and global concurrency limit, dispatches to runner.
- `src/lib/claude-runner.ts` (`runCommand`, `runningProcesses`, `RunningProcess`): Spawns `claude` CLI as child process, parses NDJSON stdout stream for session_id/result, handles timeout, writes terminal state back to DB. Performs post-processing for init and research commands.
- `src/lib/init.ts` (`ensureInitialized`): Lazy singleton guard; starts the scheduler on first HTTP request.
- `src/lib/config.ts` (`getConfig`, `CONFIG_KEYS`): Reads `max_concurrent`, `command_timeout`, `poll_interval`, `init_prompt`, `research_prompt` from DB config table with defaults.
- `src/app/api/commands/[id]/route.ts` (`PATCH`): Enforces state machine transitions via `VALID_TRANSITIONS` map. Handles abort by sending SIGTERM/SIGKILL.
- `src/app/api/tasks/[id]/commands/route.ts` (`POST`): Creates commands. Rejects if task not `ready` (403) or has running command (409). Supports `autoQueue` flag.
- `src/app/api/commands/reorder/route.ts` (`PATCH`): Batch-updates priority field for multiple commands.
- `src/app/api/commands/route.ts` (`GET`): Lists commands with JOIN to tasks+projects, filtered by status/project_id/task_id.
- `src/app/api/commands/[id]/logs/route.ts` (`GET`): Reads NDJSON log file from filesystem.

## 3. Execution Flow (LLM Retrieval Map)

### 3a. Scheduler Initialization (Lazy)

- **1.** First HTTP request hits SSE or status endpoint.
- **2.** Route calls `ensureInitialized()` in `src/lib/init.ts`. Singleton flag prevents re-entry.
- **3.** `startScheduler()` in `src/lib/scheduler.ts`: runs orphan recovery, starts `setInterval(tick, POLL_INTERVAL)`.

### 3b. Command Mode Types

The `mode` field on commands supports four values:

- `'execute'` (default): Standard execution mode. No special CLI flags.
- `'plan'`: Adds `--plan` flag to CLI args -- `src/lib/claude-runner.ts:48-50`.
- `'init'`: Auto-generated on task creation. No `--plan` flag. Triggers post-processing on completion -- `src/lib/claude-runner.ts:152-191`.
- `'research'`: Auto-generated after init. Adds `--plan` flag. Triggers task ready promotion on completion -- `src/lib/claude-runner.ts:195-200`.

### 3c. Command Creation

- **1.** `POST /api/tasks/[id]/commands` at `src/app/api/tasks/[id]/commands/route.ts:7-38`.
- **2.** Status gate: rejects with 403 if task is not `ready` -- `src/app/api/tasks/[id]/commands/route.ts:12-15`.
- **3.** Conflict check: rejects with 409 if running command exists -- `src/app/api/tasks/[id]/commands/route.ts:17-21`.
- **4.** Inserts command with status=queued (or pending if autoQueue=false).

### 3d. Scheduler Tick (Dispatch Loop)

- **1.** `tick()` at `src/lib/scheduler.ts`: reads `max_concurrent` from config, compares against `runningProcesses.size`.
- **2.** Queries `queued` commands ordered by `priority DESC, createdAt ASC`, limited to available slots.
- **3.** For each candidate, checks no other command for the same task is running (per-task serial).
- **4.** Calls `runCommand(commandId)` in `src/lib/claude-runner.ts`.

### 3e. Claude Runner Execution

- **1.** `runCommand()` at `src/lib/claude-runner.ts:20-225`: loads command/task/project from DB, determines cwd.
- **2.** Builds CLI args. Appends `--plan` for `mode='plan'` or `mode='research'` -- `src/lib/claude-runner.ts:48-50`.
- **3.** Session resumption: finds most recent command with sessionId, **skipping `mode='init'` and `mode='research'` commands** -- `src/lib/claude-runner.ts:59-65`.
- **4.** Spawns `claude` subprocess, updates command to status=running -- `src/lib/claude-runner.ts:88-94`.
- **5.** Parses NDJSON stdout for `session_id` and `result` -- `src/lib/claude-runner.ts:103-126`.
- **6.** On close: writes terminal state. Then runs mode-specific post-processing.

### 3f. Init Post-Processing (Runner)

- **1.** On exit code 0 with `mode='init'`: scans `{project.workDir}/.worktrees/` directory -- `src/lib/claude-runner.ts:157-169`.
- **2.** Updates task `worktreeDir` and sets `status='researching'` -- `src/lib/claude-runner.ts:172-176`.
- **3.** Creates a `mode='research'` command using `research_prompt` template from config -- `src/lib/claude-runner.ts:179-190`.

### 3g. Research Post-Processing (Runner)

- **1.** On exit code 0 with `mode='research'`: updates task `status='ready'` -- `src/lib/claude-runner.ts:195-200`.

### 3h. Abort Flow

- **1.** `PATCH /api/commands/[id]` with `{ status: 'aborted' }` at `src/app/api/commands/[id]/route.ts`.
- **2.** Validates transition via `VALID_TRANSITIONS` map.
- **3.** If running with pid: sends SIGTERM, schedules SIGKILL after 5s.

## 4. Design Rationale

- **Mode-based CLI flag injection** keeps the runner logic generic while supporting plan-only research.
- **Session isolation by mode** prevents init/research context from leaking into user command sessions.
- **Runner-driven post-processing** (init -> research -> ready) keeps the two-phase pipeline self-contained without additional scheduler logic.
- **Two-phase kill (SIGTERM -> SIGKILL)** gives Claude CLI 5 seconds for graceful shutdown.
