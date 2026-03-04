# MCP 反馈循环架构

## 1. 系统定位

- **是什么：** 生成的 Claude CLI 子进程与主派发应用之间的双向通信桥接，通过模型上下文协议（MCP，Model Context Protocol）基于 Streamable HTTP 实现，作为 Next.js API 路由嵌入。
- **用途：** 通过赋予 Claude 子进程通过结构化工具调用读取和写入应用任务数据库的能力，实现自主任务分解和进度汇报。

## 2. 核心组件

- `src/app/api/mcp/route.ts`（`createServer`、`POST`、`GET`、`DELETE`）：嵌入 Next.js 应用中的 Streamable HTTP MCP 端点。暴露 4 个工具：`create_task` 调用共享函数 `createTask()`（`src/lib/tasks.ts`），其余 3 个工具直接通过 Drizzle ORM 操作 SQLite 数据库。在无状态模式下使用 `WebStandardStreamableHTTPServerTransport`（`sessionIdGenerator: undefined`）。
- `src/lib/tasks.ts`（`createTask`）：任务创建共享函数，被 MCP `create_task` 工具和 REST API 共同调用。详见 `/llmdoc/architecture/tasks-architecture.md`。
- `mcp-config.json`：由 Claude CLI 读取的 MCP 客户端配置。将 `dispatch` 服务器定义为指向 `http://localhost:3000/api/mcp` 的 `type: "http"` 类型。
- `src/lib/claude-runner.ts`（`runCommand`）：生成 Claude CLI 子进程，并在项目根目录存在 `mcp-config.json` 时有条件地注入 `--mcp-config` 标志，直接传递绝对路径（不生成临时文件）。
- `src/lib/scheduler.ts`（`tick`、`startScheduler`）：轮询调度器，获取 `queued` 状态的命令并调用 `runCommand`，启动循环。
- `src/app/api/projects/[id]/tasks/route.ts`（`POST`）：任务创建端点。生成初始化命令，其提示词明确指示 Claude 使用 `create_task` MCP 工具进行递归分解。

## 3. 执行流程（LLM 检索图）

- **1. 任务创建：** 用户（或通过 MCP 的 Claude）通过 `POST /api/projects/{id}/tasks` 创建任务。`src/app/api/projects/[id]/tasks/route.ts:15-41` 中的处理器插入 `task` 行和一个自动生成的 `command`（status: `queued`），其提示词包含使用 MCP `create_task` 进行子分解的指令。
- **2. 调度：** `src/lib/scheduler.ts:tick` 轮询数据库中 `queued` 状态的命令，遵守 `max_concurrent` 限制和每任务串行执行约束，然后调用 `runCommand()`。
- **3. 注入 MCP 的进程生成：** `src/lib/claude-runner.ts:88-91` 检查 `mcp-config.json` 并追加 `--mcp-config <absolute-path>`。Claude CLI 读取此配置并通过 Streamable HTTP 传输连接到 `http://localhost:3000/api/mcp`，使 4 个 MCP 工具对 Claude 模型可用。
- **4. Claude 执行并调用 MCP 工具：** 执行期间，Claude 可以调用 4 个工具中的任意一个。`src/app/api/mcp/route.ts` 中的每个工具处理器直接通过 Drizzle ORM 查询/修改 SQLite 数据库，无中间 HTTP 调用。
- **5. 反馈完成循环：** 工具处理器写入 SQLite 数据库。通过 `create_task` 创建的新任务可以生成新的 `queued` 命令，调度器在后续 tick 中获取这些命令——形成递归循环。同时，`update_command` 允许 Claude 将自身的进度/完成状态汇报回数据库。
- **6. 进程完成：** 当 Claude 进程退出时，`src/lib/claude-runner.ts:220-261` 更新命令的最终状态，从 NDJSON 流中提取 `session_id` 和 `result`，并可选地将任务转换为 `ready` 状态。

## 4. MCP 工具参考

| 工具 | 数据库操作 | 用途 |
|------|-------------|---------|
| `create_task` | 调用 `createTask()` 共享函数（`src/lib/tasks.ts`） | 创建子任务用于分解 |
| `update_command` | `db.update(commands)` | 汇报状态/结果 |
| `get_task_context` | `db.select(tasks, commands)` | 读取任务和命令历史 |
| `list_tasks` | `db.select(tasks)` | 列出同级任务以获取上下文 |

## 5. 设计原理

- **Streamable HTTP 传输：** MCP 服务器作为 API 路由（`/api/mcp`）嵌入 Next.js 应用中。这消除了对独立 MCP 服务器二进制文件的需求，简化了部署，并移除了对 `API_BASE` 环境变量的依赖。
- **直接数据库访问：** MCP 工具现在直接导入并查询数据库（`src/lib/db`、`src/lib/schema`），绕过 REST API 层。这降低了延迟，并消除了应用调用自身 HTTP 端点的循环依赖。
- **无状态传输：** `sessionIdGenerator: undefined` 意味着每个请求都是独立的——无会话管理开销。每次请求都创建新的服务器实例。
- **通过提示工程实现递归分解：** 初始化命令提示词（`src/app/api/projects/[id]/tasks/route.ts:25-32`）明确告知 Claude，若工作量过大则使用 `create_task`，无需硬编码编排逻辑即可实现无限递归任务树。
