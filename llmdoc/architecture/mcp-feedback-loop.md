# Architecture of the MCP Feedback Loop

## 1. Identity

- **What it is:** A bidirectional communication bridge between spawned Claude CLI subprocesses and the main dispatch application, implemented via the Model Context Protocol (MCP) over stdio.
- **Purpose:** Enables autonomous task decomposition and progress reporting by giving Claude subprocesses the ability to read from and write back to the application's task database through structured tool calls.

## 2. Core Components

- `src/mcp-server-stdio.ts` (`server`, `create_task`, `update_command`, `get_task_context`, `list_tasks`): MCP server process exposing 4 tools. Communicates with the main app exclusively via HTTP REST calls to `API_BASE`.
- `mcp-config.json`: MCP client configuration consumed by the Claude CLI. Defines the `dispatch` server entry point (`pnpm exec tsx src/mcp-server-stdio.ts`) and its environment.
- `src/lib/claude-runner.ts` (`runCommand`): Spawns Claude CLI subprocesses and conditionally injects `--mcp-config` flag when `mcp-config.json` exists at the project root.
- `src/lib/scheduler.ts` (`tick`, `startScheduler`): Polling scheduler that picks `queued` commands and invokes `runCommand`, initiating the loop.
- `src/app/api/projects/[id]/tasks/route.ts` (`POST`): Task creation endpoint. Generates an init command whose prompt explicitly instructs Claude to use `create_task` MCP tool for recursive decomposition.
- `src/app/api/commands/[id]/route.ts` (`PATCH`): Command update endpoint with state machine validation. Target of the `update_command` MCP tool.
- `src/app/api/tasks/[id]/route.ts` (`GET`): Task context endpoint. Target of `get_task_context`.
- `src/app/api/tasks/route.ts` (`GET`): Task listing endpoint. Target of `list_tasks`.

## 3. Execution Flow (LLM Retrieval Map)

- **1. Task Creation:** User (or Claude via MCP) creates a task via `POST /api/projects/{id}/tasks`. The handler in `src/app/api/projects/[id]/tasks/route.ts:15-41` inserts a `task` row and an auto-generated `command` (status: `queued`) whose prompt includes instructions to use MCP `create_task` for sub-decomposition.
- **2. Scheduling:** `src/lib/scheduler.ts:tick` polls the DB for `queued` commands, respects `max_concurrent` limit and per-task serial execution, then calls `runCommand()`.
- **3. Process Spawn with MCP Injection:** `src/lib/claude-runner.ts:38-55` builds CLI args. At line 52-54, it checks for `mcp-config.json` and appends `--mcp-config <path>`. Claude CLI reads this config, spawns `src/mcp-server-stdio.ts` as a stdio child, making 4 MCP tools available to the Claude model.
- **4. Claude Executes and Calls MCP Tools:** During execution, Claude can invoke any of the 4 tools. Each tool in `src/mcp-server-stdio.ts` makes an HTTP request to the corresponding Next.js API route (e.g., `create_task` calls `POST /api/projects/{projectId}/tasks`).
- **5. Feedback Completes the Loop:** The API routes write to the SQLite database. New tasks created via `create_task` generate new `queued` commands, which the scheduler picks up in subsequent ticks -- forming a recursive loop. Meanwhile, `update_command` allows Claude to report its own progress/completion back to the DB.
- **6. Process Completion:** When the Claude process exits, `src/lib/claude-runner.ts:131-160` updates the command's final status, extracts `session_id` and `result` from the NDJSON stream, and optionally transitions the task to `ready`.

## 4. MCP Tool Reference

| Tool | HTTP Method | API Endpoint | Purpose |
|------|------------|--------------|---------|
| `create_task` | POST | `/api/projects/{projectId}/tasks` | Create sub-tasks for decomposition |
| `update_command` | PATCH | `/api/commands/{commandId}` | Report status/result back |
| `get_task_context` | GET | `/api/tasks/{taskId}` | Read task + command history |
| `list_tasks` | GET | `/api/tasks?project_id={projectId}` | List sibling tasks for context |

## 5. Design Rationale

- **Stdio transport, not HTTP server:** The MCP server runs as a child process of each Claude CLI instance (spawned per `mcp-config.json`), not as a persistent daemon. This ensures isolation and zero port conflicts.
- **HTTP-only DB access:** The MCP server never imports the database directly. All mutations route through the Next.js API layer, preserving state machine validation and single-source-of-truth enforcement.
- **Recursive decomposition by prompt engineering:** The init command prompt (`src/app/api/projects/[id]/tasks/route.ts:25-32`) explicitly tells Claude to use `create_task` if the work is too large, enabling unbounded recursive task trees without hardcoded orchestration logic.
