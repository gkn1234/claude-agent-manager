# 如何创建、排队、执行、监控和中止命令

从创建到终态，完整派发命令生命周期的指南。

1. **创建命令：** 发送 `POST /api/tasks/[taskId]/commands`，请求体为 `{ prompt: "...", mode?: "execute"|"plan", providerId: "...", autoQueue?: true }`。服务商必填。使用 `autoQueue=true`（默认）时，命令立即进入 `queued` 状态（若存在运行中命令则返回 409）。设置 `autoQueue=false` 可创建 `pending`（草稿）状态的命令——无论是否有运行中命令，草稿创建始终允许。在 UI 中，`CommandInput` 组件的 ToggleGroup 切换 Queue/Draft 模式。参考：`src/app/api/tasks/[id]/commands/route.ts:7-38`。

2. **手动入队待处理命令：** 发送 `PATCH /api/commands/[id]`，携带 `{ status: "queued" }`。仅从 `pending` 状态有效。参考：`src/app/api/commands/[id]/route.ts` 中的转换规则。

3. **调整优先级（可选）：** 发送 `PATCH /api/commands/reorder`，携带 `{ items: [{ id: "cmd-1", priority: 100 }, { id: "cmd-2", priority: 50 }] }`。优先级值越高，越先派发。参考：`src/app/api/commands/reorder/route.ts`。

4. **执行自动进行：** 调度器每隔 `poll_interval` 秒（默认 5 秒）轮询，按优先级降序再按 createdAt 升序获取排队命令，遵守 `max_concurrent`（默认 2）和每任务串行约束，然后调用 `runCommand()`。Runner 在生成 `claude` 之前注入命令的服务商环境变量。参考：`src/lib/scheduler.ts`。

5. **监控命令状态：** 使用 `GET /api/commands?status=running` 获取过滤列表，`GET /api/commands/[id]` 获取单条命令详情，或 `GET /api/commands/[id]/logs` 读取 NDJSON 执行日志。实时更新请连接 `GET /api/events`（SSE 流）。参考：`/llmdoc/architecture/commands-scheduler-architecture.md`。

6. **查看执行环境：** 在命令详情页（`/commands/[id]`）展开 "执行参数" 折叠区块，可查看该命令使用的服务商名称、工作目录、CLI 参数和脱敏环境变量。参考：`src/app/commands/[id]/page.tsx`。

7. **从命令详情页派发后续命令：** 查看某个已完成命令时，若该命令是任务中最新的终态命令且没有运行中/排队的命令，则页面吸底处会显示 `CommandInput` 组件。选择服务商、选择 Exec/Plan 模式、输入提示词后提交。页面将跳转回任务页。服务商/模式偏好将保存到任务。参考：`src/app/commands/[id]/page.tsx`，`/llmdoc/architecture/commands-scheduler-architecture.md`（第 3e/3f 节）。

8. **中止运行中命令：** 发送 `PATCH /api/commands/[id]`，携带 `{ status: "aborted" }`。仅从 `running` 状态有效。系统向 claude 进程发送 SIGTERM，5 秒后发送 SIGKILL。这是终态操作。参考：`src/app/api/commands/[id]/route.ts`。

9. **取消排队命令（可恢复）：** 发送 `PATCH /api/commands/[id]`，携带 `{ status: "pending" }`。将命令返回至可编辑草稿状态。在 UI 中，排队命令显示取消按钮（Undo2 图标）。参考：`src/app/api/commands/[id]/route.ts`。

10. **编辑待处理命令：** 发送 `PATCH /api/commands/[id]`，携带 `{ prompt, mode, providerId }` 中的任意字段。仅当命令处于 `pending` 状态时允许。在 UI 中，待处理命令渲染为带虚线边框的卡片，含内联文本框、模式/服务商选择器。参考：`src/app/api/commands/[id]/route.ts`。

11. **删除待处理命令：** 发送 `DELETE /api/commands/[id]`。仅允许 `pending` 状态的命令，将完全移除该命令。参考：`src/app/api/commands/[id]/route.ts`。

12. **验证：** 检查 `GET /api/system/status` 查看当前运行进程数、最大并发数、可用槽位和活跃 PID。参考：`src/app/api/system/status/route.ts`。
