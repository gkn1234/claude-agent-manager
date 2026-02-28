# Git 规范

本文档提供项目 git 工作流和提交规范的高层摘要及权威来源指针。

## 1. 核心摘要

项目使用单一 `main` 分支，采用线性历史（未观察到功能分支）。所有提交遵循约定式提交（Conventional Commits）格式，Claude Code 贡献的提交必须附带 `Co-Authored-By` trailer。任务级别的隔离通过 **git 工作树（worktree）** 而非分支来实现，每个任务在 `<project-work-dir>/.worktrees/` 下拥有专用工作树。

## 2. 分支策略

- **主分支：** `main`（唯一分支，无远程功能分支）。
- **任务隔离：** 使用 git 工作树代替功能分支。每个任务在 `<projectWorkDir>/.worktrees/<taskDir>` 处创建工作树。设计原理详见 `docs/initial-design.md`。
- **工作树生命周期：** 在任务初始化时（通过 `/api/tasks/:id/init` 手动触发）创建，在任务或项目被删除时通过 `cleanupTask()` 删除。清理时也会删除工作树关联的分支（保护 main/master/develop）。

## 3. 提交消息格式

所有提交使用**约定式提交（Conventional Commits）**格式（`<type>: <description>`）。

| 前缀 | 用途 | 历史示例 |
|----------|----------------------------------------------|---------------------------------------------------------|
| `feat:` | 新功能或能力 | `feat: add settings page and system config API` |
| `fix:` | 缺陷修复或更正 | `fix: consume config from DB and deduplicate config keys` |
| `chore:` | 工具、配置、非功能性变更 | `chore: initialize Next.js project with shadcn/ui` |
| `docs:` | 仅文档变更 | `docs: add detailed implementation plan` |

**从历史推断的规则：**
- 主题行使用祈使语气，前缀后小写。
- 可在括号内附加上下文说明（如 `fix: migrate MCP server to registerTool API (fix deprecation warnings)`）。
- 不使用 scope 约定（如 `feat(api):`），主题保持扁平。

## 4. 共同作者模式（Co-Author Pattern）

每次提交包含 trailer：

```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

当 Claude Code 创建提交时自动追加。

## 5. 权威来源

- **工作树设计：** `docs/initial-design.md` - 任务初始化和工作树创建流程。
- **工作树运行时使用：** `src/lib/claude-runner.ts:66-67` - 解析命令执行的 `worktreeDir`。
- **初始化后的工作树检测：** `src/lib/claude-runner.ts:239-261` - 按创建时间扫描 `.worktrees/`，排除已分配给其他任务的目录。
- **工作树清理：** `src/lib/claude-runner.ts:43-86` - `cleanupTask()` 执行 4 步清理：（1）通过 `git -C <worktreeDir>` 检测分支名，（2）通过 `git -C <mainRepoDir> worktree remove --force` 移除工作树，（3）通过 `git worktree prune` 清理陈旧元数据，（4）通过 `git branch -D` 删除分支（保护 main/master/develop）。工作树移除失败时回退到 `rmSync`。
- **工作树的 gitignore：** `.gitignore` - 将 `.worktrees/` 从版本控制中排除。
