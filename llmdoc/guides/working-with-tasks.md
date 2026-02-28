# 如何使用任务

任务代表项目内的一个隔离工作单元。每个任务拥有独立的 git 工作树，并串行执行命令。

## 任务生命周期

1. **创建任务：** `POST /api/projects/{projectId}/tasks`，携带 `{ "description": "..." }`。任务以 `status=pending` 创建，此时尚不执行初始化。参见 `src/app/api/projects/[id]/tasks/route.ts`。

2. **初始化任务：** `POST /api/tasks/{taskId}/init`，携带 `{ "providerId": "..." }`。这将任务转换为 `initializing` 状态，并使用所选服务商创建初始化命令。调度器获取该命令后，生成一个 Claude 进程来创建 git 工作树。参见 `src/app/api/tasks/[id]/init/route.ts`。

3. **等待两阶段初始化：** init 成功后，任务自动转换为 `researching` 并创建研究命令（继承服务商）。研究成功后，任务变为 `ready`。参见 `src/lib/claude-runner.ts:232-293`。

4. **添加后续命令：** `POST /api/tasks/{taskId}/commands`，携带 `{ "prompt": "...", "mode": "execute"|"plan", "providerId": "..." }`。服务商必填。命令串行执行——若已有命令在运行中，API 将拒绝请求（409）。参见 `src/app/api/tasks/[id]/commands/route.ts`。

5. **监控任务状态：** `GET /api/tasks/{taskId}` 返回任务及其所有命令。前端任务页面（`src/app/tasks/[id]/page.tsx`）每 5 秒轮询一次。任务描述在 header 中截断显示，点击可打开带完整文本的可滚动 Dialog。

6. **删除任务：** 点击任务详情页 header 中的红色 Trash2 按钮，或调用 `DELETE /api/tasks/{taskId}`。UI 通过 `confirm()` 弹窗确认后，调用 `cleanupTask()` 终止运行中的进程、删除日志文件、移除 git 工作树，并级联删除所有数据库记录。成功后跳转至项目页面。参见 `src/app/tasks/[id]/page.tsx:162-168` 和 `src/lib/claude-runner.ts:23-53`。

## 关键概念

- **工作树隔离（Worktree Isolation）：** 每个任务在 `.worktrees/` 下拥有独立的 git 工作树。多个任务可以并行处理同一仓库而不产生冲突。
- **串行命令执行：** 在单个任务内，同一时间只能有一个命令处于 `running` 状态。调度器通过跳过已有运行中命令的任务来强制执行此约束。
- **会话连续性（Session Continuity）：** 同一任务内的命令通过 `--resume {sessionId}` 自动恢复前一个 Claude 会话，跳过 init/research 会话。
- **服务商必填：** 每条命令（init、research、用户命令）都必须关联一个服务商，不存在默认兜底。
- **偏好持久化：** 任务页面通过 `PATCH /api/tasks/{id}` 保存 `lastProviderId` 和 `lastMode`，重新加载时恢复。

## 任务状态

| 状态 | 含义 |
|---|---|
| `pending` | 任务已创建，等待手动触发初始化（UI 显示服务商选择器和初始化按钮） |
| `initializing` | 初始化命令已排队/运行中（UI 显示进度指示器） |
| `researching` | 初始化完成，研究命令已排队/运行中（UI 显示进度指示器） |
| `ready` | 研究完成，任务可接受新命令（UI 显示服务商选择器、Plan/Exec 切换和命令输入框） |

## 验证任务配置

初始化任务后，通过以下方式确认完成：
- 通过 `GET /api/tasks/{taskId}` 确认任务状态为 `ready`
- 确认任务记录上的 `worktreeDir` 字段已填充
- 确认工作树目录在磁盘上已存在
