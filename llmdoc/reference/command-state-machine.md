# 命令状态机（Command State Machine）

本文档定义 `commands` 表 status 字段的完整状态转换规则。

## 1. 核心摘要

命令遵循严格的状态机，共 6 个状态：`pending`、`queued`、`running`、`completed`、`failed`、`aborted`。后三个是终态——不允许任何出向转换。转换由 PATCH 端点中的 `VALID_TRANSITIONS` 映射表强制执行，而 `queued -> running` 转换专由调度器/runner 内部执行。所有命令都需要 `providerId` 才能执行。待处理（pending）命令可编辑（prompt、mode、providerId）和删除。排队命令可取消并返回 pending（可恢复）。中止（abort）仅可从 running 状态发起（终态）。

## 2. 权威来源

- **转换规则：** `src/app/api/commands/[id]/route.ts` -- `VALID_TRANSITIONS` 常量。
- **DELETE 端点：** `src/app/api/commands/[id]/route.ts` -- 仅删除 pending 状态的命令。
- **待处理编辑支持：** `src/app/api/commands/[id]/route.ts` -- 允许 pending 时 PATCH prompt、mode、providerId。
- **Runner 状态变更：** `src/lib/claude-runner.ts`（queued->running、running->completed/failed）。
- **孤儿恢复：** `src/lib/scheduler.ts`（重启时 running->failed）。
- **相关架构：** `/llmdoc/architecture/commands-scheduler-architecture.md`

## 3. 状态转换表

| 源状态 | 允许目标 | 触发方式 |
|---|---|---|
| `pending` | `queued` | API PATCH（手动入队）。待处理命令可编辑（prompt、mode、providerId）并可通过 DELETE 端点删除。 |
| `queued` | `running`、`pending` | `running`：调度器 tick 通过 `runCommand()` 触发。`pending`：API PATCH（取消排队——可恢复，返回可编辑草稿状态）。 |
| `running` | `completed`、`failed`、`aborted` | `completed`：进程退出码为 0。`failed`：进程退出码非零或错误/超时。`aborted`：API PATCH（发送 SIGTERM/SIGKILL）。 |
| `completed` | （无——终态） | -- |
| `failed` | （无——终态） | -- |
| `aborted` | （无——终态） | -- |

## 4. 各转换的副作用

| 转换 | 副作用 |
|---|---|
| `* -> running` | 设置 `pid`、`logFile`、`startedAt`、`execEnv`；注册到 `runningProcesses` Map |
| `* -> completed` | 设置 `result`、`sessionId`、`finishedAt`；清除 `pid` |
| `* -> failed` | 设置 `result`、`finishedAt`；清除 `pid` |
| `running -> aborted` | 向 pid 发送 SIGTERM，5 秒后发送 SIGKILL；设置 `finishedAt` |
| `pending -> (delete)` | 从数据库完全移除命令行（DELETE 端点） |

## 5. 各状态的 UI 行为

| 状态 | 卡片样式 | 可用操作 |
|---|---|---|
| `pending` | 虚线边框，可编辑提示词文本框，模式/服务商选择器 | 入队（Play 图标）、删除（Trash2 图标） |
| `queued` | 标准卡片 | 取消（Undo2 图标）——发送 `{ status: 'pending' }`，可恢复 |
| `running` | 标准卡片 | 中止（Square 图标）——发送 `{ status: 'aborted' }`，终态 |
| 终态 | 标准卡片 | 无操作 |
