# 命令与调度器（Commands & Scheduler）架构

## 1. 系统定位

- **是什么：** 命令执行流水线，负责对 Claude CLI 子进程进行排队、调度和运行，在注入服务商环境变量的项目工作树中执行。
- **用途：** 提供基于优先级、受并发控制的 AI 智能体命令派发，含完整生命周期管理、执行环境审计，以及针对初始化和研究命令的自动后处理。

## 2. 核心组件

- `src/lib/schema.ts`（`commands`）：定义 `commands` SQLite 表 -- id、taskId、prompt、mode、status、priority、providerId、result、logFile、execEnv、sessionId、pid、startedAt、finishedAt、createdAt。
- `src/lib/scheduler.ts`（`startScheduler`、`stopScheduler`、`tick`、`recoverOrphanedCommands`）：基于轮询的调度器。每个 tick 从数据库读取排队命令，强制执行每任务串行和全局并发限制，然后分发给 runner。
- `src/lib/claude-runner.ts`（`runCommand`、`cleanupTask`、`runningProcesses`、`RunningProcess`）：以子进程形式生成注入了服务商环境变量的 `claude` CLI，解析 NDJSON stdout 流获取 session_id/助手文本/result/permission_denials，处理超时，记录 `execEnv` 审计对象，将终态写回数据库。将所有助手文本块累积到 `allAssistantText[]` 以实现完整结果捕获。提取 `AskUserQuestion` 权限拒绝，并以格式化 markdown 追加到命令结果中。对初始化和研究命令执行后处理。
- `src/lib/init.ts`（`ensureInitialized`）：懒加载单例守卫，在首次 HTTP 请求时启动调度器。
- `src/lib/config.ts`（`getConfig`、`CONFIG_KEYS`）：从数据库配置表读取 `max_concurrent`、`command_timeout`、`poll_interval`、`init_prompt`、`research_prompt`，带默认值。
- `src/app/api/commands/[id]/route.ts`（`GET`、`PATCH`、`DELETE`）：GET 返回命令详情，附带任务上下文字段（`taskStatus`、`taskLastProviderId`、`taskLastMode`、`isLatestFinished`、`hasRunning`），供内联命令输入区使用。PATCH 通过 `VALID_TRANSITIONS` 映射表强制状态机转换；当命令为 pending 状态时，也允许编辑 prompt、mode、providerId。处理 abort 时发送 SIGTERM/SIGKILL。DELETE 仅移除 pending 状态的命令。
- `src/app/api/tasks/[id]/commands/route.ts`（`POST`）：创建命令，需要 `providerId`。任务非 `ready` 状态时拒绝（403）。运行中命令检查（409）仅在 `autoQueue=true` 时生效；草稿（pending）创建始终允许。支持 `autoQueue` 标志。
- `src/app/api/commands/reorder/route.ts`（`PATCH`）：批量更新多条命令的 priority 字段。
- `src/app/api/commands/route.ts`（`GET`）：列出命令，JOIN 任务+项目表，leftJoin 服务商表，返回 `providerName` 字段。支持按 status/project_id/task_id 过滤。
- `src/app/api/commands/[id]/logs/route.ts`（`GET`）：从文件系统读取 NDJSON 日志文件。
- `src/app/commands/[id]/page.tsx`（`CommandDetailPage`）：命令详情 UI，三段式弹性布局：吸顶 header、可滚动内容区、吸底输入区。当 `isLatestFinished && taskStatus === 'ready' && !hasRunning` 时，在底部渲染内联命令输入区，含服务商选择器、exec/plan ToggleGroup、文本框和发送按钮。提交至 `POST /api/tasks/[taskId]/commands` 并跳转回任务页。
- `src/components/commands/command-card.tsx`（`CommandCard`、`CommandCardInner`）：在队列列表中渲染命令卡片。在状态/模式徽章旁以静默文本显示 `providerName`（来自 leftJoin）。

## 3. 执行流程（LLM 检索图）

### 3a. 命令模式类型

命令的 `mode` 字段支持四个值：

- `'execute'`（默认）：标准执行模式，无特殊 CLI 标志。
- `'plan'`：向 CLI 参数添加 `--permission-mode plan` 标志 -- `src/lib/claude-runner.ts:121-123`。
- `'init'`：任务 init 触发时自动生成，添加 `--permission-mode plan` 标志，完成时触发后处理。
- `'research'`：init 后自动生成，添加 `--permission-mode plan` 标志，完成时触发任务 ready 提升。

### 3b. 命令创建

- **1.** `POST /api/tasks/[id]/commands` -- `src/app/api/tasks/[id]/commands/route.ts:7-40`。
- **2.** 状态门控：任务非 `ready` 状态时拒绝并返回 403。
- **3.** 服务商必填：无 `providerId` 时拒绝并返回 400。
- **4.** 冲突检查（仅排队时）：若存在运行中命令且 `autoQueue=true` 则拒绝并返回 409。草稿创建绕过此检查。
- **5.** 插入 status=queued（或 autoQueue=false 时为 pending）的命令，带 `providerId`。

### 3c. 服务商环境注入

- **1.** `runCommand()` -- `src/lib/claude-runner.ts:146-171`：通过 `command.providerId` 查找服务商。
- **2.** 从 `process.env` 中清除已知冲突的环境变量（`ANTHROPIC_*`、`CLAUDE_CODE_*`）-- `src/lib/claude-runner.ts:162-164`。
- **3.** 解析服务商的 `envJson` 并合并到生成环境变量中 -- `src/lib/claude-runner.ts:166-169`。
- **4.** 在命令上记录经脱敏处理的 `execEnv` JSON（服务商名称、cwd、CLI 参数、已脱敏环境变量）-- `src/lib/claude-runner.ts:173-189`。

### 3d. Claude Runner 执行

- **1.** `runCommand()` -- `src/lib/claude-runner.ts:93-396`：从数据库加载命令/任务/项目，确定 cwd。
- **2.** 构建 CLI 参数。`mode='plan'`、`mode='research'` 或 `mode='init'` 时追加 `--permission-mode plan` -- `src/lib/claude-runner.ts:121-123`。
- **3.** 会话恢复：查找带 sessionId 的最近命令，**跳过 `mode='init'` 和 `mode='research'` 命令** -- `src/lib/claude-runner.ts:131-144`。
- **4.** 使用服务商环境变量生成 `claude` 子进程，将命令更新为 status=running -- `src/lib/claude-runner.ts:192-216`。
- **5.** NDJSON 流解析（`src/lib/claude-runner.ts:226-259`）：
  - 从第一个包含 `session_id` 的事件中捕获。
  - **累积所有助手文本：** 对每个 `type=assistant` 事件，从 `message.content` 中提取 `type=text` 块并推入 `allAssistantText[]` -- `src/lib/claude-runner.ts:240-246`。这会捕获中间分析和推理，而不仅仅是最终答案。
  - 从 `type=result` 事件中捕获 `lastResult` 作为兜底 -- `src/lib/claude-runner.ts:247-249`。
  - 从 `type=result` 事件中捕获 `permission_denials` -- `src/lib/claude-runner.ts:251-254`。
- **6.** 结果组装（`src/lib/claude-runner.ts:274-277`）：成功时，若有累积文本则使用 `allAssistantText.join('\n\n')`；兜底使用 `lastResult`（来自 result 事件）；最终兜底为 `'Command completed'`。失败时使用退出码和 stderr。
- **7.** 将 `AskUserQuestion` 权限拒绝以格式化 markdown 问题/选项追加 -- `src/lib/claude-runner.ts:279-299`，然后执行模式专属后处理。

### 3e. 内联命令输入（命令详情页）

- **1.** `GET /api/commands/[id]` -- `src/app/api/commands/[id]/route.ts:13-61`：返回命令字段及派生上下文：`taskStatus`、`taskLastProviderId`、`taskLastMode`、`isLatestFinished`、`hasRunning`。
- **2.** `isLatestFinished`：当此命令是其任务中最新的终态（completed/failed/aborted）非初始化命令时为 true -- `src/app/api/commands/[id]/route.ts:37-50`。
- **3.** `hasRunning`：当任务有任何运行中或排队的命令时为 true -- `src/app/api/commands/[id]/route.ts:26-34`。
- **4.** 当 `isLatestFinished && taskStatus === 'ready' && !hasRunning` 时页面渲染输入区 -- `src/app/commands/[id]/page.tsx:158-161`。
- **5.** 服务商/模式变更通过 `PATCH /api/tasks/[taskId]` 将偏好保存到任务 -- `src/app/commands/[id]/page.tsx:139-156`。
- **6.** 提交通过 `POST /api/tasks/[taskId]/commands` 创建命令，然后跳转回任务页（`/tasks/[taskId]`）-- `src/app/commands/[id]/page.tsx:163-178`。

### 3f. 中止与取消流程

- **1. Running -> Abort（运行中 -> 中止）：** `PATCH /api/commands/[id]`，携带 `{ status: 'aborted' }`。验证转换合法性。若运行中且有 pid：发送 SIGTERM，5 秒后发送 SIGKILL。终态。
- **2. Queued -> Cancel（排队 -> 取消）：** `PATCH /api/commands/[id]`，携带 `{ status: 'pending' }`。将命令返回至可编辑草稿状态。可恢复操作。
- **3. Pending -> Delete（待处理 -> 删除）：** `DELETE /api/commands/[id]`。仅允许 pending 状态的命令。从数据库完全移除。
- **4. Pending -> Edit（待处理 -> 编辑）：** `PATCH /api/commands/[id]`，携带 `{ prompt, mode, providerId }`。仅当命令状态为 `pending` 时允许。

### 3g. 待处理命令 UI（任务详情页）

- **1.** 待处理命令渲染为带虚线边框的内联可编辑卡片 -- `src/app/tasks/[id]/page.tsx:263-318`。
- **2.** 可编辑字段：prompt（Textarea，onBlur 时保存）、mode（选择器：Exec/Plan）、providerId（从服务商列表选择）。
- **3.** 操作：入队按钮（Play 图标，发送 `{ status: 'queued' }`）、删除按钮（Trash2 图标，调用 DELETE 端点）。
- **4.** 排队命令显示取消按钮（Undo2 图标）而非 Abort -- 发送 `{ status: 'pending' }` 进行可恢复取消。
- **5.** 运行中命令显示 Abort 按钮（Square 图标）-- 发送 `{ status: 'aborted' }` 进行终态中止。

### 3h. 任务详情底部工具栏

- **1.** 底部输入工具栏使用 `ToggleGroup`（shadcn）实现 Exec/Plan 模式切换和 Draft/Queue 切换 -- `src/app/tasks/[id]/page.tsx:435-442`。
- **2.** 草稿模式：设置 `autoQueue=false`，即使存在运行中命令，文本框和发送按钮仍保持可用。
- **3.** 排队模式（默认）：设置 `autoQueue=true`，命令在发送时立即入队。
- **4.** `handleSend` 检查 `res.ok`，失败时显示 `toast.error()` -- `src/app/tasks/[id]/page.tsx:158-164`。

## 4. 设计原理

- **通过 `allAssistantText[]` 累积实现完整结果捕获**，确保中间分析、推理和多轮助手回复被保存在命令结果中，而不仅仅是最终的 `result` 事件文本。
- **`--permission-mode plan`** 替代了旧的 `--plan` 标志，用于 init/research/plan 模式命令。
- **服务商注入环境变量** 允许不同命令使用不同 API 凭证，而无需修改服务器自身的环境变量。
- **`execEnv` 审计记录** 让用户可以通过命令详情页调试每条命令使用了哪个服务商/环境/参数。
- **按模式的会话隔离** 防止 init/research 上下文泄漏到用户命令会话中。
- **`cleanupTask()` 集中化** 处理完整清理（终止进程、日志、工作树、数据库），被任务删除和项目删除两处使用。
