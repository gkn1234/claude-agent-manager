# 任务（Tasks）架构

## 1. 系统定位

- **是什么：** 任务子系统，用于建模项目内的工作单元，通过原子创建提供 git 工作树（worktree）隔离。
- **用途：** 通过将每个任务映射到专用的 git 工作树，实现对同一代码库的并行、隔离的 AI 智能体作业。任务创建即就绪，无需初始化流程。

## 2. 核心组件

- `src/lib/schema.ts`（`tasks`、`commands`、`tasksRelations`）：定义任务和命令表。任务无 `status` 字段，`branch` 为 `notNull()`。保留 `lastProviderId`、`lastMode` 作为偏好记忆字段。
- `src/app/api/projects/[id]/tasks/route.ts`（`POST`）：原子创建任务——同步创建 git branch + worktree，成功后插入数据库。分支名可选填，不填则自动生成 `task-{uuid前缀}`，仅允许 `[a-z0-9-]`。分支名冲突返回 409。支持 `baseBranch` 参数指定新分支的起始点（start-point），不填默认为 `main`，会验证基准分支存在性（不存在返回 400）。
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

- **1. API 请求：** `POST /api/projects/{id}/tasks`，携带 `{ description, branch?, baseBranch? }` -- `src/app/api/projects/[id]/tasks/route.ts:12-74`。
- **2. 分支名处理：** 若未提供分支名，自动生成 `task-{uuid前缀}`。验证分支名格式 `[a-z0-9-]`。解析 `baseBranch`，不填默认为 `main` -- `src/app/api/projects/[id]/tasks/route.ts:20-27`。
- **3. 基准分支验证：** 通过 `git -C <workDir> branch --list <baseBranch>` 检查基准分支是否存在，不存在返回 400 -- `src/app/api/projects/[id]/tasks/route.ts:29-37`。
- **4. 分支冲突检查：** 通过 `git -C <workDir> branch --list <branch>` 检查分支是否已存在，存在则返回 409 -- `src/app/api/projects/[id]/tasks/route.ts:39-47`。
- **5. 创建 worktree：** 确保 `.worktrees/` 目录存在，执行 `git worktree add <dir> -b <branch> <baseBranch>` -- `src/app/api/projects/[id]/tasks/route.ts:49-61`。
- **6. 插入数据库：** worktree 创建成功后插入任务记录（含 branch、worktreeDir）-- `src/app/api/projects/[id]/tasks/route.ts:63-70`。
- **7. 失败回滚：** 如果 git 操作失败，直接返回错误，不插入数据库记录。

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
- **移除 status 字段** 简化了数据模型，任务创建后即可接受命令，无需等待初始化流程。
- **分支名自动生成** 降低了用户操作门槛，同时允许高级用户指定分支名。
- **`cleanupTask()` 集中化** 确保任务 DELETE 和项目 DELETE（级联）共享一致的清理逻辑。
- **`CommandInput` 共享组件** 统一了任务详情页和命令详情页的输入交互，减少代码重复。集成语音输入能力（`src/hooks/use-speech-recognition.ts`），支持浏览器兼容性检测和优雅降级。
