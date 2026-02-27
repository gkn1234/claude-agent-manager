# Claude Code 远程任务派发系统设计

> 基于胡渊鸣（Meshy AI CEO）博客《如何有效给 10 个 Claude Code 打工》的实践梳理

## 一、背景与问题

作者希望用 Vibe Coding 开发一个"CEO 支持软件"（文档写作、邮件查收、会议安排等）。过程中，核心问题从"如何 Vibe code 一个文档编辑器"演变为"如何把 Vibe coding 的速度提高 10 倍"。

## 二、作者的 10 步演进路径

### Step 1. 从 Cursor Agent 到 Claude Code

- Cursor Agent 需要 GUI，只能在桌面端使用
- 切换到 Claude Code（CLI），通过 SSH 在 iPhone 上访问
- 可编程时间从 8 小时提高到 24 小时

### Step 2. 找个 Container

- 在 EC2 上运行 Claude Code
- 使用 `--dangerously-skip-permissions` 跳过权限确认
- 单个 prompt 可持续工作约 5 分钟

```bash
claude --dangerously-skip-permissions
```

### Step 3. Ralph Loop，让 Claude Code 不停地干活

- 从任务列表中逐个取活，直到列表为空
- 用 Claude Code 写了一个 Claude Code 启动器
- Prompt 模板："干活; 干完活退出（exit）"
- "干活"的定义在 CLAUDE.md 中

### Step 4. 用 Git Worktree 实现并行化

- 每个 worktree 开一个独立的 Claude Code
- 5 个 Claude Code 并行，每个 5 分钟一个 commit → 约 1 commit/min

### Step 5. 用好 CLAUDE.md 和 PROGRESS.md

- CLAUDE.md：稳定规则，不频繁修改
- PROGRESS.md：让 AI 沉淀经验教训
- 提示语："现在把你的经验教训沉淀到 PROGRESS.md 里面，总结提炼升华，同样的错误下次不要再犯。"

### Step 6. 干掉 SSH，直接用手机端网页

- SSH 下 Claude Code 不停刷新 terminal，巨卡
- 改用 `claude -p [prompt] --dangerously-skip-permissions` 非交互式调用
- Python subprocess 调度 Claude Code
- iPhone Safari 把网页包装成 App

### Step 7. 有效地用 Claude Code 编写管理 Claude Code 的程序

- 使用 `--output-format stream-json --verbose` 获取结构化日志
- Manager CC 通过 JSON 日志诊断 Worker CC 的问题
- 派活成功率从 20% → 95%

```bash
claude -p [prompt] --dangerously-skip-permissions --output-format stream-json --verbose
```

### Step 8. 自然语言编程（语音输入）

- 所有输入框加语音识别 API
- 实现走在马路上都可以 vibe coding

### Step 9. 给开发中心添加 Plan Mode

- 封装 Claude Code 的 Plan 模式
- 批量 kick off Plan 任务 → 统一 review → 再执行

### Step 10. 坚持不去看除了 CLAUDE.md 以外的代码

- 杜绝对 AI 的微管理（micromanagement）
- "Context, not control"
- 关注：更好的提问、第一性原理、如何给 AI 铺路、版本控制与测试驱动开发

## 三、核心技术细节（截图原文整理）

### 3.1 CLAUDE.md 中的任务生命周期（截图一）

> **原文：**
>
> Task Lifecycle (for each task):
>
> 1. Pick up an available task from `dev-tasks.json` (use file lock to prevent race conditions)
> 2. Create a new git worktree for the task:
>    ```
>    git worktree add -b task/xxx ../voice-notes-worktrees/task-xxx
>    ```
> 3. Set up the worktree environment:
>    - Create isolated `data/` directory (separate test database)
>    - Symlink shared files: `dev-tasks.json`, `dev-task.lock`, `api-key.json`
>    - Symlink `node_modules/` (avoid reinstalling)
>    - **Do NOT symlink PROGRESS.md** — use `git -C` to write to the main repo directly
>    - Assign a dedicated port (e.g., 5200, 5201, 5202...)
> 4. Execute the task in the worktree
> 5. After completion:
>    - `git fetch origin main`
>    - `git rebase origin/main`
>    - If rebase fails → go to conflict resolution (see 3.2)
>    - `git checkout main && git merge task-xxx`
>    - `npm test`
>    - If tests fail → fix and retry from step 5
> 6. Push to origin: `git push origin main`
> 7. Mark task as completed in `dev-tasks.json` (**before** cleanup, to prevent state loss if process is killed)
> 8. Clean up worktree: `git worktree remove task-xxx`
> 9. (Optional) Write lessons learned to `PROGRESS.md` via `git -C /main-repo-path`
>    - If killed during this step, task state is already safe

### 3.2 冲突处理流程（截图二）

> **原文：**
>
> Conflict Resolution:
>
> **Rebase Conflicts:**
> 1. If `unstaged changes` → commit or stash first
> 2. If `merge conflicts`:
>    - Run `git status` to identify conflicted files
>    - Read each conflicted file, understand both sides' intent
>    - Manually resolve conflicts (keep both changes when possible)
>    - `git add <resolved-files>`
>    - `git rebase --continue`
>    - Repeat until rebase completes
>
> **Test Failures (after merge):**
> 1. Run `npm test`
> 2. If failed → analyze error output → fix the code → re-run tests
> 3. Repeat until all tests pass
> 4. Commit fixes: `git commit -m "fix: resolve merge/test issues"`
>
> **Core Principle: Do NOT give up.** Rebase or test failures must be resolved, not abandoned.

### 3.3 PROGRESS.md 经验沉淀规范（截图三）

> **原文：**
>
> When writing to PROGRESS.md:
>
> - What problem was encountered
> - How it was resolved
> - How to avoid it in the future
> - **Must include the git commit ID**
> - **The same mistake must not happen twice!**
>
> Write PROGRESS.md using `git -C /path/to/main-repo` to avoid worktree conflicts.
> This step is optional — if the process is killed, task state is already marked complete.

### 3.4 并行架构概览（截图四 / CLAUDE.md 架构说明）

> **原文：**
>
> Architecture:
>
> ```
> Main Repository (main branch)
>   ├── dev-tasks.json        ← shared task queue (symlinked to worktrees)
>   ├── dev-task.lock         ← file lock for atomic task pickup
>   ├── api-key.json          ← shared config (symlinked)
>   ├── CLAUDE.md             ← stable rules (inherited by worktrees)
>   ├── PROGRESS.md           ← experience log (written via git -C, NOT symlinked)
>   └── node_modules/         ← shared dependencies (symlinked)
>
> Worktrees Directory (../voice-notes-worktrees/)
>   ├── task-xxx/             ← Worker 1, port: 5200
>   │   ├── data/             ← isolated test database
>   │   ├── dev-tasks.json    → symlink to main repo
>   │   ├── dev-task.lock     → symlink to main repo
>   │   ├── api-key.json      → symlink to main repo
>   │   └── node_modules/     → symlink to main repo
>   ├── task-yyy/             ← Worker 2, port: 5201
>   └── task-zzz/             ← Worker 3, port: 5202
> ```
>
> Key rules:
> - Shared via symlink: dev-tasks.json, dev-task.lock, api-key.json, node_modules/
> - Isolated per worktree: data/, git branch, port
> - PROGRESS.md: NOT symlinked, written to main repo via `git -C`

## 四、关键设计原则

### 4.1 闭环反馈

> "只要是能够在一个闭环的环境中让 AI 能够端到端获得反馈的任务，都是简单的任务。"

写代码 → 运行 → 检查 → 调试，闭环越紧，AI 效果越好。

### 4.2 Context, not Control

不看代码，不微管理。专注于：
- 更好的提问，更清楚地描述需求
- 从第一性原理思考目标
- 给 AI 铺路，提高 AI 工作效率
- 科学的版本控制与测试驱动开发

### 4.3 经验必须沉淀

CLAUDE.md 保持稳定（规则），PROGRESS.md 持续积累（经验）。两者分离，避免频繁修改 CLAUDE.md 导致规则被改坏。

### 4.4 不放弃原则

冲突和测试失败必须解决，不能标记为失败跳过。Worker 要有自愈能力。

### 4.5 防御性状态管理

先标记任务完成，再清理 worktree。经验沉淀放在最后且标记为可选。确保任何时刻进程被杀都不会导致状态不一致。

## 五、核心 Claude Code 命令组合

```bash
# 基础：非交互式 + 跳过权限
claude -p [prompt] --dangerously-skip-permissions

# 进阶：结构化日志输出（Manager 用于监控 Worker）
claude -p [prompt] \
  --dangerously-skip-permissions \
  --output-format stream-json \
  --verbose

# 注入 worktree 工作规则
claude -p [prompt] \
  --dangerously-skip-permissions \
  --output-format stream-json \
  --verbose \
  --append-system-prompt "Worktree 规则..."
```

## 六、作者的核心洞察

1. **标准化软件的终结**：开发成本趋近于零 → 每个人都能拥有高度定制化的个人软件 → SaaS 商业模式受挑战
2. **AI 管理加速领导力**：5 分钟反馈循环 vs 人类管理的周/月反馈，管理能力成长 100x
3. **学习的意义需重新审视**：AI 迭代速度 > 人类学习速度，"花时间学才能掌握的技能"价值递减
4. **Headcount → Token count**：按人头记的组织会变成按 Token 记的组织
5. **IC ≠ Manager**：Claude Code 擅长执行，但不天然擅长管理其他 CC 实例，需要额外工程投入
