# Architecture of Commands & Scheduler

## 1. Identity

- **What it is:** The command execution pipeline that queues, schedules, and runs Claude CLI subprocesses against project worktrees.
- **Purpose:** Provides priority-based, concurrency-controlled dispatch of AI agent commands with full lifecycle management (creation through terminal state).

## 2. Core Components

- `src/lib/schema.ts` (`commands`): Defines the `commands` SQLite table -- id, taskId, prompt, mode, status, priority, result, logFile, sessionId, pid, startedAt, finishedAt, createdAt.
- `src/lib/scheduler.ts` (`startScheduler`, `stopScheduler`, `tick`, `recoverOrphanedCommands`): Polling-based scheduler. Reads queued commands from DB each tick, enforces per-task serial execution and global concurrency limit, dispatches to runner.
- `src/lib/claude-runner.ts` (`runCommand`, `runningProcesses`, `RunningProcess`): Spawns `claude` CLI as child process, parses NDJSON stdout stream for session_id/result, handles timeout (SIGTERM then SIGKILL), writes terminal state back to DB.
- `src/lib/init.ts` (`ensureInitialized`): Lazy singleton guard; starts the scheduler on first HTTP request (called by SSE and system/status routes).
- `src/lib/config.ts` (`getConfig`, `CONFIG_KEYS`): Reads `max_concurrent`, `command_timeout`, `poll_interval` from DB config table with defaults (2, 1800, 5).
- `src/app/api/commands/[id]/route.ts` (`PATCH`): Enforces state machine transitions via `VALID_TRANSITIONS` map. Handles abort by sending SIGTERM/SIGKILL to running process.
- `src/app/api/tasks/[id]/commands/route.ts` (`POST`): Creates commands. Rejects if task already has a running command. Supports `autoQueue` flag (default true -> queued, false -> pending).
- `src/app/api/commands/reorder/route.ts` (`PATCH`): Batch-updates priority field for multiple commands.
- `src/app/api/commands/route.ts` (`GET`): Lists commands with JOIN to tasks+projects, filtered by status/project_id/task_id, ordered by priority DESC + createdAt ASC.
- `src/app/api/commands/[id]/logs/route.ts` (`GET`): Reads NDJSON log file from filesystem path stored in command.logFile.

## 3. Execution Flow (LLM Retrieval Map)

### 3a. Scheduler Initialization (Lazy)

- **1.** First HTTP request hits SSE (`src/app/api/events/route.ts`) or status endpoint (`src/app/api/system/status/route.ts`).
- **2.** Route calls `ensureInitialized()` in `src/lib/init.ts:5-9`. Singleton flag prevents re-entry.
- **3.** `startScheduler()` in `src/lib/scheduler.ts:11-20`: runs orphan recovery, starts `setInterval(tick, POLL_INTERVAL)`, executes first tick immediately.

### 3b. Orphan Recovery (on startup)

- **1.** `recoverOrphanedCommands()` in `src/lib/scheduler.ts:57-82`: queries all commands with status=running.
- **2.** For each, attempts `process.kill(pid, 'SIGTERM')` then marks status=failed with finishedAt.

### 3c. Command Creation

- **1.** `POST /api/tasks/[id]/commands` at `src/app/api/tasks/[id]/commands/route.ts:7-33`.
- **2.** Checks no running command exists for this task (409 if so).
- **3.** Inserts command with status=queued (or pending if autoQueue=false), priority=0.

### 3d. Scheduler Tick (Dispatch Loop)

- **1.** `tick()` at `src/lib/scheduler.ts:29-55`: reads `max_concurrent` from config, compares against `runningProcesses.size`.
- **2.** Queries `queued` commands ordered by `priority DESC, createdAt ASC`, limited to available slots.
- **3.** For each candidate, checks no other command for the same task is already running (per-task serial).
- **4.** Calls `runCommand(commandId)` in `src/lib/claude-runner.ts:18`.

### 3e. Claude Runner Execution

- **1.** `runCommand()` at `src/lib/claude-runner.ts:18-184`: loads command/task/project from DB, determines cwd (worktreeDir or workDir).
- **2.** Builds CLI args: `-p <prompt> --dangerously-skip-permissions --output-format stream-json --verbose`. Optionally appends `--mcp-config` and `--resume <sessionId>`.
- **3.** Session resumption: finds most recent command for same task with a sessionId (`src/lib/claude-runner.ts:58-68`).
- **4.** Spawns `claude` subprocess, updates command to status=running with pid and startedAt (`src/lib/claude-runner.ts:88-93`).
- **5.** Parses NDJSON stdout line-by-line, extracts `session_id` and `result` events (`src/lib/claude-runner.ts:103-125`).
- **6.** On process close: sets status to completed (exit 0) or failed, writes result/sessionId/finishedAt (`src/lib/claude-runner.ts:131-160`).
- **7.** Timeout: after `COMMAND_TIMEOUT` seconds (default 1800), sends SIGTERM; 5s later sends SIGKILL (`src/lib/claude-runner.ts:174-183`).

### 3f. Abort Flow

- **1.** `PATCH /api/commands/[id]` with `{ status: 'aborted' }` at `src/app/api/commands/[id]/route.ts:20-57`.
- **2.** Validates transition via `VALID_TRANSITIONS` map (`src/app/api/commands/[id]/route.ts:6-11`).
- **3.** If current status is running and pid exists: sends SIGTERM, schedules SIGKILL after 5s (`src/app/api/commands/[id]/route.ts:38-45`).
- **4.** Sets finishedAt and persists.

### 3g. Priority Reordering

- **1.** `PATCH /api/commands/reorder` at `src/app/api/commands/reorder/route.ts:6-21`: accepts `{ items: [{ id, priority }] }`, batch-updates priority column.
- **2.** Next scheduler tick picks up reordered priorities automatically (queries by `priority DESC`).

## 4. Design Rationale

- **Lazy initialization** avoids scheduler startup during build/test; only activates on first real request.
- **Per-task serial execution** prevents concurrent Claude sessions from conflicting in the same worktree.
- **In-memory `runningProcesses` Map** enables instant concurrency checks and pid-based abort without DB polling.
- **NDJSON stream parsing** allows real-time session_id extraction for multi-turn conversation resumption.
- **Two-phase kill (SIGTERM -> SIGKILL)** gives Claude CLI 5 seconds for graceful shutdown before forced termination.
