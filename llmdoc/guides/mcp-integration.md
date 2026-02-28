# 如何配置、扩展或调试 MCP 集成

MCP 反馈循环的操作指南。完整架构请参见 `/llmdoc/architecture/mcp-feedback-loop.md`。

## 配置 MCP 服务器

1. **验证配置：** `mcp-config.json` 定义了一个 `dispatch` 服务器，类型为 `"type": "http"`，URL 为 `"http://localhost:3000/api/mcp"`。若应用运行在不同端口，请更新 URL。
2. **验证配置检测：** `src/lib/claude-runner.ts:88-91` 在 `process.cwd()` 处检查 `mcp-config.json`。确保应用从项目根目录启动，否则 MCP 工具将静默不加载。
3. **无需单独的服务器进程：** MCP 端点已嵌入 Next.js 应用（`src/app/api/mcp/route.ts`）。只要 Next.js 应用在运行，MCP 服务器即可用。

## 添加新 MCP 工具

1. **定义工具：** 在 `src/app/api/mcp/route.ts` 的 `createServer()` 函数中使用 `server.registerTool()` 定义工具。遵循现有模式：定义 `description`、`inputSchema`（zod）以及直接通过 Drizzle ORM 查询/修改数据库的异步处理器。
2. **测试工具：** 创建一个提示词指示 Claude 使用新工具名称的任务。检查 `./logs/<commandId>.ndjson` 中的 NDJSON 日志文件，查看工具调用痕迹。

## 调试 MCP 通信

1. **检查 MCP 是否已注入：** 在命令的 NDJSON 日志（`./logs/<commandId>.ndjson`）中搜索 MCP 相关事件。若没有，请确认项目根目录存在 `mcp-config.json`。
2. **确认应用在运行：** MCP 工具由位于 `/api/mcp` 的 Next.js 应用提供服务。若应用未运行，所有工具调用都将失败。MCP 服务器嵌入在 Next.js 应用中，不作为独立进程运行。
3. **检查 HTTP 传输：** 端点处理 `POST`、`GET` 和 `DELETE` 请求。工具调用以 `POST` 请求到达。传输是无状态的（`sessionIdGenerator: undefined`），因此每个请求都是独立的。
4. **检查数据库访问：** MCP 工具现在直接操作数据库。若工具返回错误，请检查 SQLite 数据库是否可访问且未被锁定。

## 常见问题

- **工具对 Claude 不可用：** `mcp-config.json` 在 `process.cwd()` 处未找到。确保应用从项目根目录启动。
- **所有工具调用失败：** Next.js 应用未在运行。MCP 端点（`/api/mcp`）是应用的一部分——请先启动应用。
- **`update_command` 未强制状态机：** 注意 MCP `update_command` 工具执行的是直接数据库更新，不进行状态机验证（与 REST `PATCH /api/commands/:id` 端点不同）。进行状态转换时请谨慎。
- **递归任务创建失控：** 没有内置的深度限制。通过 `list_tasks` 监控任务数量，或在 `create_task` 处理器中添加深度检查。
