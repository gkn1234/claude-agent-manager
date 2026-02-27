# Command State Machine

This document defines the complete state transition rules for the `commands` table status field.

## 1. Core Summary

Commands follow a strict state machine with 6 states: `pending`, `queued`, `running`, `completed`, `failed`, `aborted`. The last three are terminal -- no outbound transitions are permitted. Transitions are enforced by the `VALID_TRANSITIONS` map in the PATCH endpoint, while `queued -> running` is performed exclusively by the scheduler/runner internally.

## 2. Source of Truth

- **Transition rules:** `src/app/api/commands/[id]/route.ts:6-11` -- the `VALID_TRANSITIONS` constant.
- **Runner state changes:** `src/lib/claude-runner.ts:88-93` (queued->running), `src/lib/claude-runner.ts:131-148` (running->completed/failed).
- **Orphan recovery:** `src/lib/scheduler.ts:57-82` (running->failed on restart).
- **Related architecture:** `/llmdoc/architecture/commands-scheduler-architecture.md`

## 3. State Transition Table

| From State | Allowed Targets | Trigger |
|---|---|---|
| `pending` | `queued`, `aborted` | API PATCH (manual queue or abort) |
| `queued` | `running`, `pending`, `aborted` | `running`: scheduler tick via `runCommand()`. `pending`: API PATCH (de-queue). `aborted`: API PATCH. |
| `running` | `completed`, `failed`, `aborted` | `completed`: process exits code 0. `failed`: process exits non-zero or error/timeout. `aborted`: API PATCH (sends SIGTERM/SIGKILL). |
| `completed` | (none -- terminal) | -- |
| `failed` | (none -- terminal) | -- |
| `aborted` | (none -- terminal) | -- |

## 4. Side Effects by Transition

| Transition | Side Effect |
|---|---|
| `* -> running` | Sets `pid`, `logFile`, `startedAt`; registers in `runningProcesses` Map |
| `* -> completed` | Sets `result`, `sessionId`, `finishedAt`; clears `pid`; may update task status to `ready` |
| `* -> failed` | Sets `result`, `finishedAt`; clears `pid` |
| `running -> aborted` | Sends SIGTERM to pid, SIGKILL after 5s; sets `finishedAt` |
| `pending/queued -> aborted` | Sets `finishedAt` only |
