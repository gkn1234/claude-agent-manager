# 如何使用任务

任务代表项目内的一个隔离工作单元。每个任务拥有独立的 git 工作树，创建时原子生成，创建后即可接受命令。

## 任务生命周期

1. **创建任务：** `POST /api/projects/{projectId}/tasks`，携带 `{ "description": "...", "branch": "my-branch", "baseBranch": "dev" }`。`branch` 为选填，不填则自动生成 `task-{uuid前缀}`，仅允许 `[a-z0-9-]`。`baseBranch` 为选填，指定新分支的起始点（start-point），不填默认为 `main`；API 会验证基准分支存在性。创建时同步生成 git branch + worktree（`git worktree add <dir> -b <branch> <baseBranch>`），如果失败则不创建任务。参见 `src/app/api/projects/[id]/tasks/route.ts`。

2. **添加命令：** `POST /api/tasks/{taskId}/commands`，携带 `{ "prompt": "...", "mode": "execute"|"plan", "providerId": "..." }`。服务商必填。使用 `autoQueue=true`（默认）时立即排队；`autoQueue=false` 创建草稿。草稿创建不受运行中命令限制。参见 `src/app/api/tasks/[id]/commands/route.ts`。

3. **监控任务状态：** `GET /api/tasks/{taskId}` 返回任务及其所有命令。前端任务页面（`src/app/tasks/[id]/page.tsx`）每 5 秒轮询一次。

4. **删除任务：** 点击任务详情页 header 中的红色 Trash2 按钮，或调用 `DELETE /api/tasks/{taskId}`。UI 通过 `confirm()` 弹窗确认后，调用 `cleanupTask()` 终止运行中的进程、删除日志文件、移除 git 工作树，并级联删除所有数据库记录。成功后跳转至项目页面。参见 `src/lib/claude-runner.ts:21-89`。

## 关键概念

- **原子创建：** 任务创建时同步执行 git branch + worktree 创建。如果 git 操作失败，不会插入数据库记录，保证数据一致性。
- **工作树隔离（Worktree Isolation）：** 每个任务在 `.worktrees/` 下拥有独立的 git 工作树。多个任务可以并行处理同一仓库而不产生冲突。
- **串行命令执行：** 在单个任务内，同一时间只能有一个命令处于 `running` 状态。调度器通过跳过已有运行中命令的任务来强制执行此约束。
- **会话连续性（Session Continuity）：** 同一任务内的命令通过 `--resume {sessionId}` 自动恢复前一个 Claude 会话。
- **服务商必填：** 每条命令都必须关联一个服务商，不存在默认兜底。
- **偏好持久化：** `CommandInput` 组件通过 `PATCH /api/tasks/{id}` 保存 `lastProviderId` 和 `lastMode`，重新加载时恢复。

## 验证任务创建

创建任务后，通过以下方式确认完成：
- 通过 `GET /api/tasks/{taskId}` 确认任务记录存在
- 确认 `branch` 和 `worktreeDir` 字段已填充
- 确认工作树目录在磁盘上已存在
