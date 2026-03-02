# 命令与调度器（Commands & Scheduler）架构

## 1. 系统定位

- **是什么：** 命令执行流水线，负责对 Claude CLI 子进程进行排队、调度和运行，在注入服务商环境变量的项目工作树中执行。
- **用途：** 提供基于优先级、受并发控制的 AI 智能体命令派发，含完整生命周期管理和执行环境审计。

## 2. 核心组件

- `src/lib/schema.ts`（`commands`）：定义 `commands` SQLite 表 -- id、taskId、prompt、mode、status、priority、providerId、result、logFile、execEnv、sessionId、pid、startedAt、finishedAt、createdAt。
- `src/lib/scheduler.ts`（`startScheduler`、`stopScheduler`、`tick`、`recoverOrphanedCommands`）：基于轮询的调度器。每个 tick 从数据库读取排队命令，强制执行每任务串行和全局并发限制，然后分发给 runner。
- `src/lib/claude-runner.ts`（`runCommand`、`cleanupTask`、`runningProcesses`、`RunningProcess`）：以子进程形式生成注入了服务商环境变量的 `claude` CLI，解析 NDJSON stdout 流获取 session_id/助手文本/result/permission_denials，处理超时，记录 `execEnv` 审计对象，将终态写回数据库。将所有助手文本块累积到 `allAssistantText[]` 以实现完整结果捕获。提取 `AskUserQuestion` 权限拒绝，并以格式化 markdown 追加到命令结果中。
- `src/lib/init.ts`（`ensureInitialized`）：懒加载单例守卫，在首次 HTTP 请求时启动调度器。
- `src/lib/config.ts`（`getConfig`、`CONFIG_KEYS`）：从数据库配置表读取 `max_concurrent`、`command_timeout`、`poll_interval`，带默认值。
- `src/app/api/commands/[id]/route.ts`（`GET`、`PATCH`、`DELETE`）：GET 返回命令详情，附带任务上下文字段（`taskLastProviderId`、`taskLastMode`、`isLatestFinished`、`hasRunning`），供内联命令输入区使用。PATCH 通过 `VALID_TRANSITIONS` 映射表强制状态机转换；当命令为 pending 状态时，也允许编辑 prompt、mode、providerId。处理 abort 时发送 SIGTERM/SIGKILL。DELETE 仅移除 pending 状态的命令。
- `src/app/api/tasks/[id]/commands/route.ts`（`POST`）：创建命令，需要 `providerId`。无状态门控（任务无 status 字段）。运行中命令检查（409）仅在 `autoQueue=true` 时生效；草稿（pending）创建始终允许。支持 `autoQueue` 标志。
- `src/app/api/commands/reorder/route.ts`（`PATCH`）：批量更新多条命令的 priority 字段。
- `src/app/api/commands/route.ts`（`GET`）：列出命令，JOIN 任务+项目表，leftJoin 服务商表，返回 `providerName` 字段。支持按 status/project_id/task_id 过滤。
- `src/app/api/commands/[id]/logs/route.ts`（`GET`）：从文件系统读取 NDJSON 日志文件。
- `src/app/commands/[id]/page.tsx`（`CommandDetailPage`）：命令详情 UI，三段式弹性布局：吸顶 header、可滚动内容区、吸底输入区。当 `isLatestFinished && !hasRunning` 时，在底部渲染 `CommandInput` 共享组件。提交后跳转回任务页。
- `src/components/commands/command-input.tsx`（`CommandInput`）：共享命令输入组件，支持 provider 选择、Exec/Plan ToggleGroup、Draft/Queue ToggleGroup、语音输入（通过麦克风按钮）、偏好自动保存到任务。被任务详情页和命令详情页共用。
- `src/hooks/use-speech-recognition.ts`（`useSpeechRecognition`）：封装浏览器 Web Speech API 的自定义 hook，提供 `isSupported`、`isListening`、`start`、`stop` 接口，支持 `onResult`/`onInterim`/`onError` 回调。默认语言 `zh-CN`。
- `src/components/commands/command-card.tsx`（`CommandCard`、`CommandCardInner`）：在队列列表中渲染命令卡片。在状态/模式徽章旁以静默文本显示 `providerName`（来自 leftJoin）。

## 3. 执行流程（LLM 检索图）

### 3a. 命令模式类型

命令的 `mode` 字段支持两个值：

- `'execute'`（默认）：标准执行模式，无特殊 CLI 标志。
- `'plan'`：向 CLI 参数添加 `--permission-mode plan` 标志 -- `src/lib/claude-runner.ts:119-121`。

### 3b. 命令创建

- **1.** `POST /api/tasks/[id]/commands` -- `src/app/api/tasks/[id]/commands/route.ts:7-38`。
- **2.** 服务商必填：无 `providerId` 时拒绝并返回 400。
- **3.** 冲突检查（仅排队时）：若存在运行中命令且 `autoQueue=true` 则拒绝并返回 409。草稿创建绕过此检查。
- **4.** 插入 status=queued（或 autoQueue=false 时为 pending）的命令，带 `providerId`。

### 3c. 服务商环境注入

- **1.** `runCommand()` -- `src/lib/claude-runner.ts:142-167`：通过 `command.providerId` 查找服务商。
- **2.** 从 `process.env` 中清除已知冲突的环境变量（`ANTHROPIC_*`、`CLAUDE_CODE_*`）-- `src/lib/claude-runner.ts:158-160`。
- **3.** 解析服务商的 `envJson` 并合并到生成环境变量中 -- `src/lib/claude-runner.ts:162-165`。
- **4.** 在命令上记录经脱敏处理的 `execEnv` JSON（服务商名称、cwd、CLI 参数、已脱敏环境变量）-- `src/lib/claude-runner.ts:169-185`。

### 3d. Claude Runner 执行

- **1.** `runCommand()` -- `src/lib/claude-runner.ts:91-329`：从数据库加载命令/任务/项目，确定 cwd。
- **2.** 构建 CLI 参数。`mode='plan'` 时追加 `--permission-mode plan` -- `src/lib/claude-runner.ts:119-121`。
- **3.** 会话恢复：查找同任务中带 sessionId 的最近命令 -- `src/lib/claude-runner.ts:130-140`。
- **4.** 使用服务商环境变量生成 `claude` 子进程，将命令更新为 status=running -- `src/lib/claude-runner.ts:188-212`。
- **5.** NDJSON 流解析（`src/lib/claude-runner.ts:222-256`）：
  - 从第一个包含 `session_id` 的事件中捕获。
  - **累积所有助手文本：** 对每个 `type=assistant` 事件，从 `message.content` 中提取 `type=text` 块并推入 `allAssistantText[]`。
  - 从 `type=result` 事件中捕获 `lastResult` 作为兜底。
  - 从 `type=result` 事件中捕获 `permission_denials`。
- **6.** 结果组装（`src/lib/claude-runner.ts:270-273`）：成功时，若有累积文本则使用 `allAssistantText.join('\n\n')`；兜底使用 `lastResult`；最终兜底为 `'Command completed'`。失败时使用退出码和 stderr。
- **7.** 将 `AskUserQuestion` 权限拒绝以格式化 markdown 追加 -- `src/lib/claude-runner.ts:276-295`。

### 3e. 共享命令输入组件（CommandInput）

- **1.** `src/components/commands/command-input.tsx`（`CommandInput`）：独立组件，接收 `taskId`、`initialProviderId`、`initialMode`、`showDraftToggle`、`disabled`、`onSent` 等 Props。
- **2.** 自动获取服务商列表，初始化偏好（provider/mode）从 Props 传入。
- **3.** provider/mode 变更时通过 `PATCH /api/tasks/[taskId]` 保存偏好 -- `src/components/commands/command-input.tsx:91-97`。
- **4.** 提交通过 `POST /api/tasks/[taskId]/commands` 创建命令 -- `src/components/commands/command-input.tsx:112-134`。
- **5.** 任务详情页（`src/app/tasks/[id]/page.tsx:272-280`）和命令详情页（`src/app/commands/[id]/page.tsx:247-258`）均使用此组件。
- **6.** 语音输入：集成 `src/hooks/use-speech-recognition.ts`（`useSpeechRecognition`）自定义 hook，封装浏览器原生 Web Speech API。点击麦克风按钮（Mic/MicOff 图标）切换录音状态 -- `src/components/commands/command-input.tsx:136-144`。实时显示 interim results（覆盖在已输入文本后），最终识别结果追加到 prompt。不支持 Speech API 的浏览器自动隐藏按钮（优雅降级）-- `src/components/commands/command-input.tsx:198-209`。录音中按钮显示红色（`variant='destructive'`）并带脉动动画（`animate-pulse`）。

### 3f. 内联命令输入条件（命令详情页）

- **1.** `GET /api/commands/[id]` 返回派生上下文：`taskLastProviderId`、`taskLastMode`、`isLatestFinished`、`hasRunning`。
- **2.** 当 `isLatestFinished && !hasRunning` 时页面渲染 `CommandInput` -- `src/app/commands/[id]/page.tsx:104-106`。
- **3.** 提交后跳转回任务页（`/tasks/[taskId]`）。

### 3g. 中止与取消流程

- **1. Running -> Abort（运行中 -> 中止）：** `PATCH /api/commands/[id]`，携带 `{ status: 'aborted' }`。验证转换合法性。若运行中且有 pid：发送 SIGTERM，5 秒后发送 SIGKILL。终态。
- **2. Queued -> Cancel（排队 -> 取消）：** `PATCH /api/commands/[id]`，携带 `{ status: 'pending' }`。将命令返回至可编辑草稿状态。可恢复操作。
- **3. Pending -> Delete（待处理 -> 删除）：** `DELETE /api/commands/[id]`。仅允许 pending 状态的命令。从数据库完全移除。
- **4. Pending -> Edit（待处理 -> 编辑）：** `PATCH /api/commands/[id]`，携带 `{ prompt, mode, providerId }`。仅当命令状态为 `pending` 时允许。

### 3h. 待处理命令 UI（任务详情页）

- **1.** 待处理命令渲染为带虚线边框的内联可编辑卡片 -- `src/app/tasks/[id]/page.tsx:168-222`。
- **2.** 可编辑字段：prompt（Textarea，onBlur 时保存）、mode（选择器：Exec/Plan）、providerId（从服务商列表选择）。
- **3.** 操作：入队按钮（Play 图标，发送 `{ status: 'queued' }`）、删除按钮（Trash2 图标，调用 DELETE 端点）。
- **4.** 排队命令显示取消按钮（Undo2 图标）而非 Abort -- 发送 `{ status: 'pending' }` 进行可恢复取消。
- **5.** 运行中命令显示 Abort 按钮（Square 图标）-- 发送 `{ status: 'aborted' }` 进行终态中止。

## 4. 设计原理

- **通过 `allAssistantText[]` 累积实现完整结果捕获**，确保中间分析、推理和多轮助手回复被保存在命令结果中。
- **`--permission-mode plan`** 用于 plan 模式命令。
- **服务商注入环境变量** 允许不同命令使用不同 API 凭证，而无需修改服务器自身的环境变量。
- **`execEnv` 审计记录** 让用户可以通过命令详情页调试每条命令使用了哪个服务商/环境/参数。
- **`CommandInput` 共享组件** 统一了任务详情页和命令详情页的输入交互，避免代码重复并保持行为一致。集成语音输入能力，通过 `useSpeechRecognition` hook 实现，不支持的浏览器优雅降级（隐藏按钮）。
- **`cleanupTask()` 集中化** 处理完整清理（终止进程、日志、工作树、数据库），被任务删除和项目删除两处使用。
