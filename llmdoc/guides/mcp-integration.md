# How to Configure, Extend, or Debug the MCP Integration

Operational guide for working with the MCP feedback loop. See `/llmdoc/architecture/mcp-feedback-loop.md` for the full architecture.

## Configure the MCP Server

1. **Set API_BASE:** Edit `mcp-config.json` to change the `env.API_BASE` value. Default is `http://localhost:3000`. This must point to the running Next.js app.
2. **Verify config detection:** `src/lib/claude-runner.ts:52-54` checks for `mcp-config.json` at `process.cwd()`. Ensure the app is started from the project root, or the MCP tools will silently not load.

## Add a New MCP Tool

1. **Define the tool** in `src/mcp-server-stdio.ts` using `server.registerTool()`. Follow the existing pattern: define `description`, `inputSchema` (zod), and an async handler that calls a REST endpoint.
2. **Create or identify the API route** under `src/app/api/` that the tool will call. Ensure it handles errors and returns JSON.
3. **Test the tool** by creating a task whose prompt instructs Claude to use the new tool name. Check the NDJSON log file in `./logs/<commandId>.ndjson` for tool invocation traces.

## Debug MCP Communication

1. **Check if MCP is injected:** Search the command's NDJSON log (`./logs/<commandId>.ndjson`) for MCP-related events. If absent, verify `mcp-config.json` exists at the project root.
2. **Inspect MCP server startup:** The MCP server logs errors to stderr. If it fails to start, the Claude process will lack tools but may still run. Check `src/mcp-server-stdio.ts:179-182` for the error handler.
3. **Verify API connectivity:** The MCP server calls `API_BASE` (default `localhost:3000`). If the Next.js app is not running, all tool calls will return `Failed to create/update/get` errors. These errors are returned to Claude as `isError: true` responses.
4. **Test tools in isolation:** Run `pnpm exec tsx src/mcp-server-stdio.ts` manually and send MCP protocol messages via stdin to verify tool behavior independently of Claude.

## Common Issues

- **Tools not available to Claude:** `mcp-config.json` not found at `process.cwd()`. Ensure the app launches from the project root.
- **`update_command` returns 400:** The command status state machine (`src/app/api/commands/[id]/route.ts`) rejects invalid transitions. Valid paths: `pending -> queued/aborted`, `queued -> running/pending/aborted`, `running -> completed/failed/aborted`.
- **Recursive task creation runs away:** No built-in depth limit exists. Monitor task count via `list_tasks` or add a depth check in the task creation API.
