# Architecture of the MCP Feedback Loop

## 1. Identity

- **What it is:** A bidirectional communication bridge between spawned Claude CLI subprocesses and the main dispatch application, implemented via the Model Context Protocol (MCP) over Streamable HTTP, embedded as a Next.js API route.
- **Purpose:** Enables autonomous task decomposition and progress reporting by giving Claude subprocesses the ability to read from and write back to the application's task database through structured tool calls.

## 2. Core Components

- `src/app/api/mcp/route.ts` (`createServer`, `POST`, `GET`, `DELETE`): Streamable HTTP MCP endpoint embedded in the Next.js app. Exposes 4 tools that operate directly on the SQLite database via Drizzle ORM (no HTTP self-calls). Uses `WebStandardStreamableHTTPServerTransport` in stateless mode (`sessionIdGenerator: undefined`).
- `mcp-config.json`: MCP client configuration consumed by the Claude CLI. Defines the `dispatch` server as `type: "http"` pointing to `http://localhost:3000/api/mcp`.
- `src/lib/claude-runner.ts` (`runCommand`): Spawns Claude CLI subprocesses and conditionally injects `--mcp-config` flag when `mcp-config.json` exists at the project root. Passes the absolute path directly (no temp file generation).
- `src/lib/scheduler.ts` (`tick`, `startScheduler`): Polling scheduler that picks `queued` commands and invokes `runCommand`, initiating the loop.
- `src/app/api/projects/[id]/tasks/route.ts` (`POST`): Task creation endpoint. Generates an init command whose prompt explicitly instructs Claude to use `create_task` MCP tool for recursive decomposition.

## 3. Execution Flow (LLM Retrieval Map)

- **1. Task Creation:** User (or Claude via MCP) creates a task via `POST /api/projects/{id}/tasks`. The handler in `src/app/api/projects/[id]/tasks/route.ts:15-41` inserts a `task` row and an auto-generated `command` (status: `queued`) whose prompt includes instructions to use MCP `create_task` for sub-decomposition.
- **2. Scheduling:** `src/lib/scheduler.ts:tick` polls the DB for `queued` commands, respects `max_concurrent` limit and per-task serial execution, then calls `runCommand()`.
- **3. Process Spawn with MCP Injection:** `src/lib/claude-runner.ts:88-91` checks for `mcp-config.json` and appends `--mcp-config <absolute-path>`. Claude CLI reads this config and connects to `http://localhost:3000/api/mcp` via Streamable HTTP transport, making 4 MCP tools available to the Claude model.
- **4. Claude Executes and Calls MCP Tools:** During execution, Claude can invoke any of the 4 tools. Each tool handler in `src/app/api/mcp/route.ts` directly queries/mutates the SQLite database via Drizzle ORM -- no intermediate HTTP calls to other API routes.
- **5. Feedback Completes the Loop:** Tool handlers write to the SQLite database. New tasks created via `create_task` can generate new `queued` commands, which the scheduler picks up in subsequent ticks -- forming a recursive loop. Meanwhile, `update_command` allows Claude to report its own progress/completion back to the DB.
- **6. Process Completion:** When the Claude process exits, `src/lib/claude-runner.ts:220-261` updates the command's final status, extracts `session_id` and `result` from the NDJSON stream, and optionally transitions the task to `ready`.

## 4. MCP Tool Reference

| Tool | DB Operation | Purpose |
|------|-------------|---------|
| `create_task` | `db.insert(tasks)` | Create sub-tasks for decomposition |
| `update_command` | `db.update(commands)` | Report status/result back |
| `get_task_context` | `db.select(tasks, commands)` | Read task + command history |
| `list_tasks` | `db.select(tasks)` | List sibling tasks for context |

## 5. Design Rationale

- **Streamable HTTP, not stdio:** The MCP server is embedded in the Next.js app as an API route (`/api/mcp`), not a separate stdio process. This eliminates the need for a standalone MCP server binary, simplifies deployment, and removes the dependency on `API_BASE` environment variable.
- **Direct DB access:** The MCP tools now import and query the database directly (`src/lib/db`, `src/lib/schema`), bypassing the REST API layer. This reduces latency and removes the circular dependency of the app calling its own HTTP endpoints.
- **Stateless transport:** `sessionIdGenerator: undefined` means each request is independent -- no session management overhead. The server instance is created fresh per request.
- **Recursive decomposition by prompt engineering:** The init command prompt (`src/app/api/projects/[id]/tasks/route.ts:25-32`) explicitly tells Claude to use `create_task` if the work is too large, enabling unbounded recursive task trees without hardcoded orchestration logic.
