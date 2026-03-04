# 任务（Tasks）架构

## 1. 系统定位

- **是什么：** 任务子系统，用于建模项目内的工作单元，通过原子创建提供 git 工作树（worktree）隔离。
- **用途：** 通过将每个任务映射到专用的 git 工作树，实现对同一代码库的并行、隔离的 AI 智能体作业。任务创建即就绪，无需初始化流程。

## 2. 核心组件

- `src/lib/schema.ts`（`tasks`、`commands`、`tasksRelations`）：定义任务和命令表。任务无 `status` 字段，`branch` 为 `notNull()`。保留 `lastProviderId`、`lastMode` 作为偏好记忆字段。
- `src/lib/tasks.ts`（`createTask`、`CreateTaskParams`、`CreateTaskResult`）：任务创建的共享核心逻辑。接受 `{ projectId, description, branch?, baseBranch? }`，执行完整创建流程（项目查找、分支名处理、baseBranch 验证、分支冲突检查、worktree 创建、DB 插入）。返回 Result 类型：`{ ok: true, task }` 或 `{ ok: false, error, code }`，code 为 `'not_found' | 'validation' | 'conflict' | 'internal'`。被 REST API 和 MCP `create_task` 工具共同调用。
- `src/app/api/projects/[id]/tasks/route.ts`（`POST`）：REST API 薄层，调用 `createTask()` 共享函数并将 error code 映射为 HTTP 状态码（not_found→404, validation→400, conflict→409, internal→500）。
- `src/app/api/tasks/route.ts`（`GET`）：列出任务，支持 `?project_id=` 过滤。
- `src/app/api/tasks/[id]/route.ts`（`GET`、`PATCH`、`DELETE`）：获取任务及其命令；更新 `lastProviderId`/`lastMode` 偏好设置；通过 `cleanupTask()` 删除任务。
- `src/app/tasks/[id]/page.tsx`（`TaskPage`）：任务详情 UI，采用三段式弹性布局（吸顶 header、可滚动命令时间线、吸底输入框）。Header 显示任务名和分支名（无状态 Badge）。含删除按钮（Trash2 图标、confirm 弹窗，成功后跳转至项目页）。命令时间线将待处理命令渲染为带虚线边框的可编辑卡片；排队命令显示取消按钮（Undo2）；运行中命令显示中止按钮（Square）。底部使用 `CommandInput` 共享组件。
- `src/app/api/tasks/[id]/commands/route.ts`（`POST`）：向任务添加命令，需要 `providerId`。无状态门控（任务无 status 字段）。运行中命令检查（409）仅在 `autoQueue=true` 时生效；草稿（pending）创建始终允许。
- `src/lib/scheduler.ts`（`tick`）：轮询排队命令。通过跳过已有运行中命令的任务来强制每任务串行执行。
- `src/lib/claude-runner.ts`（`runCommand`、`cleanupTask`）：在任务的 `worktreeDir` 中生成注入了服务商环境变量的 `claude` CLI。`cleanupTask` 执行完整清理（终止进程、删除日志、移除工作树和分支、删除数据库记录），使用 `git -C <mainRepoDir>` 保证正确的仓库上下文。
- `src/components/projects/create-task-dialog.tsx`（`CreateTaskDialog`）：创建任务对话框，包含任务名称（Input）、基准分支（Input，选填，font-mono，placeholder "默认为 main"）和分支名（Input，选填，font-mono，带格式验证反馈）。
- `src/components/commands/command-input.tsx`（`CommandInput`）：共享命令输入组件，被任务详情页和命令详情页共用。支持 provider 选择、Exec/Plan 模式切换、Draft/Queue 模式切换、语音输入（麦克风按钮，基于 Web Speech API，不支持时自动隐藏）、偏好自动保存。

## 3. 执行流程（LLM 检索图）

### 任务创建（原子操作）

- **1. 入口调用：** REST API（`src/app/api/projects/[id]/tasks/route.ts:11-22`）或 MCP `create_task` 工具（`src/app/api/mcp/route.ts:29-35`）调用共享函数 `createTask()` -- `src/lib/tasks.ts:22-87`。
- **2. 项目查找：** 查询数据库确认项目存在，不存在返回 `not_found` -- `src/lib/tasks.ts:25-28`。
- **3. 分支名处理：** 若未提供分支名，自动生成 `task-{uuid前缀}`。验证分支名格式 `[a-z0-9-]`。解析 `baseBranch`，不填默认为 `main` -- `src/lib/tasks.ts:34-40`。
- **4. 基准分支验证：** 通过 `git -C <workDir> branch --list <baseBranch>` 检查基准分支是否存在，不存在返回 `validation` -- `src/lib/tasks.ts:43-50`。
- **5. 分支冲突检查：** 通过 `git -C <workDir> branch --list <branch>` 检查分支是否已存在，存在则返回 `conflict` -- `src/lib/tasks.ts:53-60`。
- **6. 创建 worktree：** 确保 `.worktrees/` 目录存在，执行 `git worktree add <dir> -b <branch> <baseBranch>` -- `src/lib/tasks.ts:63-74`。
- **7. 插入数据库：** worktree 创建成功后插入任务记录（含 branch、worktreeDir）-- `src/lib/tasks.ts:77-83`。
- **8. 调用方映射：** REST API 将 error code 映射为 HTTP 状态码（`src/app/api/projects/[id]/tasks/route.ts:4-9`）；MCP 将错误映射为 `isError: true` 格式（`src/app/api/mcp/route.ts:31-32`）。

### 向任务添加命令

- **1. API 请求：** `POST /api/tasks/{id}/commands`，携带 `{ prompt, mode?, autoQueue?, providerId }` -- `src/app/api/tasks/[id]/commands/route.ts:7-38`。
- **2. 服务商必填：** 未提供 `providerId` 时拒绝并返回 400。
- **3. 冲突检查（仅排队时）：** 当 `autoQueue=true` 时，若存在 `status='running'` 的命令则拒绝并返回 409。草稿创建（`autoQueue=false`）绕过此检查。

### 任务删除（清理）

- **1. UI 触发：** 任务详情页 header 有红色删除按钮（Trash2 图标），点击触发 `confirm()` 弹窗 -- `src/app/tasks/[id]/page.tsx:81-87`。
- **2. API 请求：** `DELETE /api/tasks/{id}` -- `src/app/api/tasks/[id]/route.ts`。
- **3. `cleanupTask()`：** `src/lib/claude-runner.ts:21-89` 执行：终止运行中的进程（SIGTERM+SIGKILL）、删除日志文件、检测工作树分支名（`git -C <worktreeDir> rev-parse --abbrev-ref HEAD`）、移除 git 工作树（`git -C <mainRepoDir> worktree remove --force`）、失败时回退到 `rmSync` + `git worktree prune`、删除工作树分支（`git -C <mainRepoDir> branch -D`，保护 main/master/develop）、删除命令和任务数据库记录。
- **4. 跳转：** 成功后导航至父项目页面（`/projects/{projectId}`）。

## 4. 设计原理

- **原子创建** 保证任务记录与 git 资源的一致性——不会出现数据库有记录但无 worktree 的情况。
- **共享 `createTask()` 函数** 将核心创建逻辑抽取到 `src/lib/tasks.ts`，REST API 和 MCP 工具共用同一实现，消除代码重复并确保行为一致。Result 类型设计使调用方可按需映射错误（HTTP 状态码或 MCP isError 格式）。
- **移除 status 字段** 简化了数据模型，任务创建后即可接受命令，无需等待初始化流程。
- **分支名自动生成** 降低了用户操作门槛，同时允许高级用户指定分支名。
- **`cleanupTask()` 集中化** 确保任务 DELETE 和项目 DELETE（级联）共享一致的清理逻辑。
- **`CommandInput` 共享组件** 统一了任务详情页和命令详情页的输入交互，减少代码重复。集成语音输入能力（`src/hooks/use-speech-recognition.ts`），支持浏览器兼容性检测和优雅降级。
