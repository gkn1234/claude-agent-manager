# Architecture of Commands & Scheduler

## 1. Identity

- **What it is:** The command execution pipeline that queues, schedules, and runs Claude CLI subprocesses against project worktrees with provider-injected environments.
- **Purpose:** Provides priority-based, concurrency-controlled dispatch of AI agent commands with full lifecycle management, execution environment auditing, and automated post-processing for init and research commands.

## 2. Core Components

- `src/lib/schema.ts` (`commands`): Defines the `commands` SQLite table -- id, taskId, prompt, mode, status, priority, providerId, result, logFile, execEnv, sessionId, pid, startedAt, finishedAt, createdAt.
- `src/lib/scheduler.ts` (`startScheduler`, `stopScheduler`, `tick`, `recoverOrphanedCommands`): Polling-based scheduler. Reads queued commands from DB each tick, enforces per-task serial execution and global concurrency limit, dispatches to runner.
- `src/lib/claude-runner.ts` (`runCommand`, `cleanupTask`, `runningProcesses`, `RunningProcess`): Spawns `claude` CLI as child process with provider env injection, parses NDJSON stdout stream for session_id/result, handles timeout, records `execEnv` audit blob, writes terminal state back to DB. Performs post-processing for init and research commands.
- `src/lib/init.ts` (`ensureInitialized`): Lazy singleton guard; starts the scheduler on first HTTP request.
- `src/lib/config.ts` (`getConfig`, `CONFIG_KEYS`): Reads `max_concurrent`, `command_timeout`, `poll_interval`, `init_prompt`, `research_prompt` from DB config table with defaults.
- `src/app/api/commands/[id]/route.ts` (`PATCH`): Enforces state machine transitions via `VALID_TRANSITIONS` map. Handles abort by sending SIGTERM/SIGKILL.
- `src/app/api/tasks/[id]/commands/route.ts` (`POST`): Creates commands. Requires `providerId`. Rejects if task not `ready` (403) or has running command (409). Supports `autoQueue` flag.
- `src/app/api/commands/reorder/route.ts` (`PATCH`): Batch-updates priority field for multiple commands.
- `src/app/api/commands/route.ts` (`GET`): Lists commands with JOIN to tasks+projects, filtered by status/project_id/task_id.
- `src/app/api/commands/[id]/logs/route.ts` (`GET`): Reads NDJSON log file from filesystem.

## 3. Execution Flow (LLM Retrieval Map)

### 3a. Command Mode Types

The `mode` field on commands supports four values:

- `'execute'` (default): Standard execution mode. No special CLI flags.
- `'plan'`: Adds `--permission-mode plan` flag to CLI args -- `src/lib/claude-runner.ts:83-85`.
- `'init'`: Auto-generated on task init trigger. No `--permission-mode` flag. Triggers post-processing on completion.
- `'research'`: Auto-generated after init. Adds `--permission-mode plan` flag. Triggers task ready promotion on completion.

### 3b. Command Creation

- **1.** `POST /api/tasks/[id]/commands` at `src/app/api/tasks/[id]/commands/route.ts:7-40`.
- **2.** Status gate: rejects with 403 if task is not `ready`.
- **3.** Provider required: rejects with 400 if no `providerId`.
- **4.** Conflict check: rejects with 409 if running command exists.
- **5.** Inserts command with status=queued (or pending if autoQueue=false), with `providerId`.

### 3c. Provider Environment Injection

- **1.** `runCommand()` at `src/lib/claude-runner.ts:107-131`: looks up provider by `command.providerId`.
- **2.** Clears known conflicting env vars (`ANTHROPIC_*`, `CLAUDE_CODE_*`) from `process.env` -- `src/lib/claude-runner.ts:122-124`.
- **3.** Parses provider's `envJson` and merges into spawn env -- `src/lib/claude-runner.ts:126-129`.
- **4.** Records sanitized `execEnv` JSON (provider name, cwd, CLI args, masked env vars) on the command -- `src/lib/claude-runner.ts:134-149`.

### 3d. Claude Runner Execution

- **1.** `runCommand()` at `src/lib/claude-runner.ts:55-318`: loads command/task/project from DB, determines cwd.
- **2.** Builds CLI args. Appends `--permission-mode plan` for `mode='plan'` or `mode='research'` -- `src/lib/claude-runner.ts:83-85`.
- **3.** Session resumption: finds most recent command with sessionId, **skipping `mode='init'` and `mode='research'` commands** -- `src/lib/claude-runner.ts:94-100`.
- **4.** Spawns `claude` subprocess with provider env, updates command to status=running -- `src/lib/claude-runner.ts:152-174`.
- **5.** Parses NDJSON stdout for `session_id` and `result` -- `src/lib/claude-runner.ts:184-206`.
- **6.** On close: writes terminal state. Then runs mode-specific post-processing.

### 3e. Abort Flow

- **1.** `PATCH /api/commands/[id]` with `{ status: 'aborted' }` at `src/app/api/commands/[id]/route.ts`.
- **2.** Validates transition via `VALID_TRANSITIONS` map.
- **3.** If running with pid: sends SIGTERM, schedules SIGKILL after 5s.

## 4. Design Rationale

- **`--permission-mode plan`** replaces the old `--plan` flag for research/plan mode commands.
- **Provider-injected environments** allow different commands to use different API credentials without changing the server's own env.
- **`execEnv` audit trail** enables debugging which provider/env/args were used for each command via the command detail page.
- **Session isolation by mode** prevents init/research context from leaking into user command sessions.
- **`cleanupTask()` centralization** handles full cleanup (kill, logs, worktree, DB) used by both task and project deletion.
