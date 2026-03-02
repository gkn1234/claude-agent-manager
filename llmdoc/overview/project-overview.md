# Claude Dispatch

## 1. 系统定位

- **是什么：** 一个 Next.js Web 应用，用于向运行在 ECS 服务器上的 Claude Code CLI 进程远程派发任务，具备实时监控和基于 MCP 的反馈循环。
- **用途：** 让用户通过移动端优先的 Web UI 管理 AI 驱动的编码任务，在隔离的 git 工作树（worktree）上编排 Claude Code 的执行，支持基于优先级的调度、并发执行控制和可配置的服务商配置文件。

## 2. 高层描述

Claude Dispatch 是一个基于三层实体层级构建的任务编排系统：**项目（Projects）**（git 仓库）包含**任务（Tasks）**（具有隔离 git 工作树的工作单元），任务包含**命令（Commands）**（单次 Claude Code 调用，含提示词、状态和结果）。**服务商配置文件（Provider Profiles）** 提供命名的 API 凭证配置，注入到 CLI 子进程中。轮询调度器消费排队的命令，使用所选服务商的环境变量生成 `claude` CLI 子进程，并管理其生命周期，包括超时强制执行（SIGTERM/SIGKILL）。实时 UI 更新通过 SSE（服务器发送事件）流式推送，使用 2 秒数据库轮询检测变更。

## 3. 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Next.js 16.1（App Router，所有页面均为客户端渲染） |
| UI | React 19、shadcn/ui（Radix UI）、Tailwind CSS 4、Lucide 图标、sonner（toast 通知） |
| 数据库 | SQLite，通过 better-sqlite3 + Drizzle ORM（WAL 模式） |
| AI 集成 | Claude Code CLI（作为子进程生成，NDJSON 流解析） |
| MCP | `@modelcontextprotocol/sdk` 1.27 - Streamable HTTP 传输，作为 Next.js API 路由（`/api/mcp`）嵌入 |
| 拖放 | `@dnd-kit/core` + `@dnd-kit/sortable`（服务商排序） |
| 验证 | Zod 4 |
| 包管理器 | pnpm |
| 语言 | TypeScript 5 |

## 4. 实体层级

```
项目 Projects（git 仓库注册）
  └── 任务 Tasks（每个任务一个隔离的 git 工作树，创建时原子生成）
        └── 命令 Commands（单次 claude CLI 调用）
              状态: pending → queued → running → completed/failed/aborted

服务商 Providers（命名 API 凭证配置文件，按 sortOrder 排序）
  └── 被 Commands（providerId）和 Tasks（lastProviderId）引用
```

- `src/lib/schema.ts`（`projects`、`tasks`、`commands`、`providers`、`config`）- Drizzle ORM 表定义。任务表无 `status` 字段，`branch` 为必填。
- 各层级之间为一对多关系。级联删除通过 `cleanupTask()` 自顶向下流转。

## 5. 关键架构模式

**服务商配置文件（Provider Profiles）：** `src/lib/schema.ts`（`providers`）存储带自由格式环境键值对的命名配置。所有命令都必须有服务商——不存在默认环境变量兜底。Runner 在生成 CLI 之前清除冲突的环境变量，然后注入服务商的 `envJson`。

**原子任务创建：** 任务创建时同步执行 git branch + worktree 创建。如果 branch/worktree 创建失败，任务不会被插入数据库。分支名可选填，不填则自动生成 `task-{uuid前缀}`，仅允许 `[a-z0-9-]` 字符。任务创建后即可接受命令，无需初始化流程。

**调度器轮询循环：** `src/lib/scheduler.ts`（`tick`）每隔 N 秒轮询数据库查找 `queued` 状态的命令，遵守 `max_concurrent` 限制和每任务串行执行约束。通过 `src/lib/init.ts` 在首次 HTTP 请求时懒加载初始化。

**SSE 实时更新：** `src/app/api/events/route.ts` 维护 SSE 连接，每 2 秒轮询活跃命令，推送变更通知。客户端 `src/hooks/use-commands.ts` 接收 SSE 事件后通过 REST 重新获取完整命令列表（包括 `providerName`）以保证一致性。

**MCP 反馈循环：** `src/app/api/mcp/route.ts` 通过 Streamable HTTP MCP（无状态模式）向 Claude 子进程暴露 4 个工具（`create_task`、`update_command`、`get_task_context`、`list_tasks`）。这些工具直接操作 SQLite 数据库，使 Claude 能够自我分解任务、汇报进度和查询上下文。

**会话连续性（Session Continuity）：** `src/lib/claude-runner.ts`（`runCommand`）自动传递同一任务中前一条命令的 `--resume <sessionId>`，实现跨命令的多轮对话。

**执行环境审计（Execution Environment Audit）：** 每条命令记录经脱敏处理的 `execEnv` JSON 对象（服务商名称、工作目录、CLI 参数、已脱敏环境变量），用于调试。

**共享命令输入组件：** `src/components/commands/command-input.tsx`（`CommandInput`）被任务详情页和命令详情页共用，提供服务商选择、Exec/Plan 模式切换、Draft/Queue 模式切换、语音输入（通过 `src/hooks/use-speech-recognition.ts` 封装 Web Speech API，支持实时 interim 展示、最终结果追加、浏览器不支持时自动隐藏按钮），以及偏好自动保存。

## 6. 移动端优先响应式设计

- `src/components/nav/app-shell.tsx`（`AppShell`）- 使用 `useIsMobile()`（768px 断点）在 `BottomTabs`（移动端）和 `Sidebar`（桌面端）之间切换。
- 所有页面均为 `'use client'` 组件，界面语言为简体中文（zh-CN）。
- 共 6 个路由：`/`（命令队列，含项目/任务筛选）、`/projects`、`/projects/[id]`、`/tasks/[id]`、`/commands/[id]`、`/settings`。
