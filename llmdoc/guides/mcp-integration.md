# How to Configure, Extend, or Debug the MCP Integration

Operational guide for working with the MCP feedback loop. See `/llmdoc/architecture/mcp-feedback-loop.md` for the full architecture.

## Configure the MCP Server

1. **Verify config:** `mcp-config.json` defines a single `dispatch` server with `"type": "http"` and `"url": "http://localhost:3000/api/mcp"`. If your app runs on a different port, update the URL.
2. **Verify config detection:** `src/lib/claude-runner.ts:88-91` checks for `mcp-config.json` at `process.cwd()`. Ensure the app is started from the project root, or the MCP tools will silently not load.
3. **No separate server process needed:** The MCP endpoint is embedded in the Next.js app (`src/app/api/mcp/route.ts`). As long as the Next.js app is running, the MCP server is available.

## Add a New MCP Tool

1. **Define the tool** in `src/app/api/mcp/route.ts` inside the `createServer()` function using `server.registerTool()`. Follow the existing pattern: define `description`, `inputSchema` (zod), and an async handler that directly queries/mutates the DB via Drizzle ORM.
2. **Test the tool** by creating a task whose prompt instructs Claude to use the new tool name. Check the NDJSON log file in `./logs/<commandId>.ndjson` for tool invocation traces.

## Debug MCP Communication

1. **Check if MCP is injected:** Search the command's NDJSON log (`./logs/<commandId>.ndjson`) for MCP-related events. If absent, verify `mcp-config.json` exists at the project root.
2. **Verify app is running:** The MCP tools are served by the Next.js app at `/api/mcp`. If the app is not running, all tool calls will fail. Unlike the old stdio transport, the MCP server does not run as a separate process.
3. **Inspect HTTP transport:** The endpoint handles `POST`, `GET`, and `DELETE` requests. Tool calls arrive as `POST` requests. The transport is stateless (`sessionIdGenerator: undefined`), so each request is independent.
4. **Check DB access:** MCP tools now operate directly on the database. If tools return errors, check that the SQLite database is accessible and not locked.

## Common Issues

- **Tools not available to Claude:** `mcp-config.json` not found at `process.cwd()`. Ensure the app launches from the project root.
- **All tool calls fail:** The Next.js app is not running. The MCP endpoint (`/api/mcp`) is part of the app -- start the app first.
- **`update_command` does not enforce state machine:** Note that the MCP `update_command` tool performs a direct DB update without state machine validation (unlike the REST `PATCH /api/commands/:id` endpoint). Exercise caution with status transitions.
- **Recursive task creation runs away:** No built-in depth limit exists. Monitor task count via `list_tasks` or add a depth check in the `create_task` handler.
