# 项目（Projects）架构

## 1. 系统定位

- **是什么：** 代表系统管理的 git 仓库的顶级实体。
- **用途：** 为任务和命令提供工作空间隔离；每个项目映射到具有 git 能力的文件系统目录。

## 2. 核心组件

- `src/lib/schema.ts`（`projects`、`projectsRelations`）：定义 `projects` 表（id、name、work_dir、git_remote、created_at、updated_at）及其与 `tasks` 的一对多关系。
- `src/app/api/projects/route.ts`（`GET`、`POST`）：列出所有项目，并以三种模式（clone、new、local）处理创建请求。
- `src/app/api/projects/[id]/route.ts`（`GET`、`DELETE`）：获取单个项目及其任务，或通过对每个任务调用 `cleanupTask()` 进行级联删除。
- `src/lib/utils/git.ts`（`isGitRepo`、`gitClone`、`gitInit`、`getGitRemote`、`ensureGitignoreEntry`）：Git CLI 工具函数（无 shell 注入风险）。`gitClone` 为异步函数（`promisify(execFile)`），带 120 秒超时和失败自动清理。`gitInit` 执行三步操作：`git init` → `git checkout -b main`（确保默认分支名为 main）→ `git commit --allow-empty -m 'Initial commit'`（确保仓库立即拥有 main 分支和初始提交，可直接创建任务）。其余函数使用 `execFileSync`。
- `src/lib/claude-runner.ts`（`cleanupTask`）：被项目 DELETE 接口用于清理每个任务（终止进程、删除日志、通过 `git -C` 移除工作树和分支、删除数据库记录）。移除失败时回退到 `rmSync` + `git worktree prune`。

## 3. 执行流程（LLM 检索图）

### 3a. 项目创建（POST /api/projects）

- **1. 请求解析：** `src/app/api/projects/route.ts:22-24` - 从 JSON 请求体中提取 `{ name, workDir, gitUrl, mode }`。
- **2. 目录解析：** `src/app/api/projects/route.ts:12-15`（`resolveProjectDir`）- 若未提供 `workDir`，默认使用 `~/claude-agent-manager/<name>`。
- **3. 模式专属 git 操作：**
  - **clone** (`src/app/api/projects/route.ts:32-63`)：需要 `gitUrl`。若目录存在且为同一仓库则复用；否则返回 409。若目录不存在则 `await gitClone(gitUrl, finalDir)`（异步，120 秒超时，超时/失败自动清理残留目录）。try-catch 捕获错误后解析 git stderr 中的 `fatal:` 行，返回用户友好的 JSON 错误响应（`{ error: "git clone 失败: ..." }`，500）。
  - **new** (`src/app/api/projects/route.ts:64-75`)：用 `mkdirSync` 创建目录，然后执行 `gitInit(finalDir)`（含 `git init` + `checkout -b main` + 空初始提交，确保新项目立即可创建任务）。目录不得已存在（409）。
  - **local** (`src/app/api/projects/route.ts:76-85`)：直接使用现有 `workDir`，必须存在且为 git 仓库（否则 400）。
- **4. Gitignore 设置：** `src/app/api/projects/route.ts:87` - 所有模式均调用 `ensureGitignoreEntry(finalDir, '.worktrees/')`。
- **5. 数据库插入：** `src/app/api/projects/route.ts:89-92` - 生成 UUID，读取 git remote，向 `projects` 表插入行。返回 201。

### 3b. 项目删除（DELETE /api/projects/[id]）

- **1. 查找：** `src/app/api/projects/[id]/route.ts:17-19` - 查找项目，不存在则 404。
- **2. 级联清理：** `src/app/api/projects/[id]/route.ts:21-24` - 对每个任务调用 `cleanupTask(task.id)`，该函数会终止运行中的进程、删除日志文件、移除 git 工作树（使用 `git -C` 保证正确的仓库上下文）及其分支，并删除命令和任务数据库记录。
- **3. 删除项目：** `src/app/api/projects/[id]/route.ts:25` - 删除项目行本身。

## 4. 设计原理

- **三种创建模式** 提供了灵活性：`clone` 用于已有远程仓库，`new` 用于全新项目，`local` 用于已有本地仓库。
- **将 `.worktrees/` 加入 gitignore** 是普遍适用的，因为任务会在项目目录下创建 git 工作树用于工作空间隔离。
- **`cleanupTask()` 用于级联删除**，确保终止运行中的进程并移除工作树，而不仅仅是删除数据库记录。
- **`execFileSync`** 用于大多数 git 操作（而非带 shell 字符串的 `exec`），以防止命令注入。`gitClone` 使用异步 `promisify(execFile)` 以避免阻塞，并加入 120 秒超时保护和失败时自动清理残留目录。
