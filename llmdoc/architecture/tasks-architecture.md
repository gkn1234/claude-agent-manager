# 任务（Tasks）架构

## 1. 系统定位

- **是什么：** 任务子系统，用于建模项目内的工作单元，提供 git 工作树（worktree）隔离和手动触发的初始化流水线（pending -> init -> research -> ready）。
- **用途：** 通过将每个任务映射到专用的 git 工作树，并在接受用户命令前自动执行研究分析，实现对同一代码库的并行、隔离的 AI 智能体作业。

## 2. 核心组件

- `src/lib/schema.ts`（`tasks`、`commands`、`tasksRelations`）：定义任务和命令表。任务保存工作树元数据、`lastProviderId`、`lastMode`；命令保存执行状态，包括 `providerId` 和 `execEnv`。一对多关系：项目 -> 任务 -> 命令。
- `src/app/api/projects/[id]/tasks/route.ts`（`POST`）：以 `pending` 状态创建任务。创建时不自动生成初始化命令。
- `src/app/api/tasks/[id]/init/route.ts`（`POST`）：手动触发初始化，需要 `providerId`。将任务从 `pending` 转换为 `initializing`，并创建带服务商的 `mode='init'` 命令。
- `src/app/api/tasks/route.ts`（`GET`）：列出任务，支持 `?project_id=` 过滤。
- `src/app/api/tasks/[id]/route.ts`（`GET`、`PATCH`、`DELETE`）：获取任务及其命令；更新 `lastProviderId`/`lastMode` 偏好设置；通过 `cleanupTask()` 删除任务。
- `src/app/tasks/[id]/page.tsx`（`TaskPage`）：任务详情 UI，采用三段式弹性布局（吸顶 header、可滚动命令时间线、吸底输入框）。Header 包含删除按钮（Trash2 图标、确认弹窗，成功后跳转至项目页）。任务描述截断显示，点击展开可滚动的 Dialog（`max-h-[80vh]`）。命令时间线将待处理命令渲染为带虚线边框的可编辑卡片（提示词文本框、模式/服务商选择器、入队/删除按钮）；排队命令显示取消按钮（Undo2，返回 pending）；运行中命令显示中止按钮（Square）。服务商名称通过客户端将 `cmd.providerId` 映射到已获取的 `providers` 列表来显示。底部工具栏使用 `ToggleGroup` 实现 Exec/Plan 和 Draft/Queue 分段切换。`handleSend` 检查 `res.ok`，失败时显示 `toast.error()`。
- `src/app/api/tasks/[id]/commands/route.ts`（`POST`）：向任务添加命令，需要 `providerId`。任务状态非 `ready` 时拒绝（403）。运行中命令检查（409）仅在 `autoQueue=true` 时生效；草稿（pending）创建始终允许，不受运行中命令影响。
- `src/lib/scheduler.ts`（`tick`）：轮询排队命令。通过跳过已有运行中命令的任务来强制每任务串行执行。
- `src/lib/claude-runner.ts`（`runCommand`、`cleanupTask`）：在任务的 `worktreeDir` 中生成注入了服务商环境变量的 `claude` CLI。初始化成功时：扫描 `.worktrees/` 中按创建时间排序的最新目录（排除已分配给其他任务的目录），将状态设为 `researching`，创建研究命令。研究成功时：将任务提升为 `ready`。`cleanupTask` 执行完整清理（终止进程、删除日志、移除工作树和分支、删除数据库记录），使用 `git -C <mainRepoDir>` 保证正确的仓库上下文。
- `src/components/projects/create-task-dialog.tsx`（`CreateTaskDialog`）：创建任务的对话框。DialogContent 使用 `max-h-[80vh] flex flex-col`；Textarea 使用 `max-h-[50vh] overflow-y-auto`，处理长描述而不溢出。
- `src/lib/config.ts`（`getConfig`、`CONFIG_DEFAULTS`）：提供带占位符替换的 `init_prompt` 和 `research_prompt` 模板。

## 3. 执行流程（LLM 检索图）

### 任务创建

- **1. API 请求：** `POST /api/projects/{id}/tasks`，携带 `{ description }` -- `src/app/api/projects/[id]/tasks/route.ts:7-25`。
- **2. 任务插入：** 插入 `status='pending'` 的任务行 -- `src/app/api/projects/[id]/tasks/route.ts:16-21`。此时尚不创建初始化命令。

### 手动触发初始化

- **3. API 请求：** `POST /api/tasks/{id}/init`，携带 `{ providerId }` -- `src/app/api/tasks/[id]/init/route.ts:8-51`。
- **4. 验证：** 任务非 `pending` 状态（409）、服务商未找到（404）时拒绝。
- **5. 状态更新：** 设置任务 `status='initializing'`，`lastProviderId` -- `src/app/api/tasks/[id]/init/route.ts:27-31`。
- **6. 初始化命令：** 读取 `init_prompt` 模板，替换 `{workDir}` 和 `{description}`，创建 `mode='init'`、`status='queued'`、`priority=10`、带 `providerId` 的命令 -- `src/app/api/tasks/[id]/init/route.ts:34-48`。

### 两阶段初始化流水线

- **7. 初始化执行：** 调度器获取初始化命令。Runner 使用 `--permission-mode plan` 和注入的服务商环境变量生成 `claude` CLI -- `src/lib/claude-runner.ts:55-156`。
- **8. 工作树检测：** 退出码为 0 且 `mode='init'` 时：扫描 `.worktrees/` 中按创建时间（`birthtimeMs`）排序的最新目录，排除已分配给其他任务的目录 -- `src/lib/claude-runner.ts:239-261`。
- **9. 研究命令自动创建：** 创建 `mode='research'` 命令（plan 模式），使用 `research_prompt` 模板，从初始化命令继承 `providerId` -- `src/lib/claude-runner.ts:271-283`。
- **10. 任务就绪：** 研究命令退出码为 0 时：任务状态更新为 `ready` -- `src/lib/claude-runner.ts:288-292`。

### 向任务添加命令

- **1. API 请求：** `POST /api/tasks/{id}/commands`，携带 `{ prompt, mode?, autoQueue?, providerId }` -- `src/app/api/tasks/[id]/commands/route.ts:7-40`。
- **2. 状态门控：** `task.status !== 'ready'` 时拒绝并返回 403。
- **3. 服务商必填：** 未提供 `providerId` 时拒绝并返回 400。
- **4. 冲突检查（仅排队时）：** 当 `autoQueue=true` 时，若存在 `status='running'` 的命令则拒绝并返回 409。草稿创建（`autoQueue=false`）绕过此检查。

### 任务删除（清理）

- **1. UI 触发：** 任务详情页 header 有红色删除按钮（Trash2 图标），点击触发 `confirm()` 弹窗 -- `src/app/tasks/[id]/page.tsx:162-168`。
- **2. API 请求：** `DELETE /api/tasks/{id}` -- `src/app/api/tasks/[id]/route.ts:31-38`。
- **3. `cleanupTask()`：** `src/lib/claude-runner.ts:23-91` 执行：终止运行中的进程（SIGTERM+SIGKILL）、删除日志文件、检测工作树分支名（`git -C <worktreeDir> rev-parse --abbrev-ref HEAD`）、移除 git 工作树（`git -C <mainRepoDir> worktree remove --force`）、失败时回退到 `rmSync` + `git worktree prune`、删除工作树分支（`git -C <mainRepoDir> branch -D`，保护 main/master/develop）、删除命令和任务数据库记录。
- **4. 跳转：** 成功后导航至父项目页面（`/projects/{projectId}`）。

### 任务状态机（State Machine）

```
pending → initializing → researching → ready
```

- `pending`：任务已创建，等待手动触发初始化。UI 显示服务商选择器和初始化按钮。
- `initializing`：初始化命令已排队/运行中。UI 显示进度指示器。
- `researching`：初始化完成，研究命令已排队/运行中。UI 显示进度指示器。
- `ready`：研究完成。UI 显示服务商选择器、Plan/Exec 切换和命令输入框。

## 4. 设计原理

- **手动初始化触发** 允许用户在初始化开始前选择服务商配置文件，而不是自动使用默认服务商启动。
- **两阶段初始化** 将环境设置（init）与代码库分析（research）分离，确保智能体在接受工作前拥有完整上下文。
- **按创建时间检测工作树并排除已分配目录**，防止多个任务并发初始化时出现误归属。
- **`cleanupTask()` 集中化** 确保任务 DELETE 和项目 DELETE（级联）共享一致的清理逻辑。
- **从初始化到研究命令的服务商继承**，确保整个初始化过程使用相同的 API 凭证。
