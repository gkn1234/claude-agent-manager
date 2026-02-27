# How to Create, Queue, Execute, Monitor, and Abort Commands

A guide for dispatching commands through the system's lifecycle, from creation to terminal state.

1. **Create a command:** Send `POST /api/tasks/[taskId]/commands` with body `{ prompt: "...", mode?: "execute"|"plan", autoQueue?: true }`. With `autoQueue=true` (default), the command enters `queued` status immediately. Set `autoQueue=false` to create in `pending` status for manual review. Reference: `src/app/api/tasks/[id]/commands/route.ts:7-33`.

2. **Manually queue a pending command:** Send `PATCH /api/commands/[id]` with `{ status: "queued" }`. Only valid from `pending` status. Reference: `src/app/api/commands/[id]/route.ts:6-11` for transition rules.

3. **Adjust priority (optional):** Send `PATCH /api/commands/reorder` with `{ items: [{ id: "cmd-1", priority: 100 }, { id: "cmd-2", priority: 50 }] }`. Higher priority values are dispatched first. Reference: `src/app/api/commands/reorder/route.ts:6-21`.

4. **Execution happens automatically:** The scheduler polls every `poll_interval` seconds (default 5), picks queued commands by priority DESC then createdAt ASC, respects `max_concurrent` (default 2) and per-task serial constraint, and calls `runCommand()`. No manual intervention needed. Reference: `src/lib/scheduler.ts:29-55`.

5. **Monitor command status:** Use `GET /api/commands?status=running` for filtered lists, `GET /api/commands/[id]` for single command detail, or `GET /api/commands/[id]/logs` to read the NDJSON execution log. For real-time updates, connect to `GET /api/events` (SSE stream). Reference: `/llmdoc/architecture/commands-scheduler-architecture.md`.

6. **Abort a running command:** Send `PATCH /api/commands/[id]` with `{ status: "aborted" }`. If the command is running, the system sends SIGTERM to the claude process, followed by SIGKILL after 5 seconds. Works from `pending`, `queued`, or `running` states. Reference: `src/app/api/commands/[id]/route.ts:38-45`.

7. **Verify:** Check `GET /api/system/status` to see current running process count, max concurrency, available slots, and active PIDs. Reference: `src/app/api/system/status/route.ts`.
