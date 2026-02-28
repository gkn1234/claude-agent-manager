# llmdoc 索引

Claude Dispatch 文档的 LLM 智能体导航入口。请按顺序阅读文档：先阅读概述，再阅读架构，最后按需阅读指南/参考。

## 概述

| 文档 | 描述 |
|---|---|
| [project-overview](overview/project-overview.md) | Claude Dispatch 是什么：一个用于远程向 Claude Code CLI 进程派发任务的 Next.js 应用，具备实时监控、服务商配置文件（Provider Profiles）和 MCP 反馈循环。涵盖系统定位、技术栈、实体层级（项目 -> 任务 -> 命令，服务商）及关键模式。 |

## 架构

| 文档 | 描述 |
|---|---|
| [projects-architecture](architecture/projects-architecture.md) | 项目（Projects）实体的工作方式：数据模式、API 路由、git 工具函数、三种创建模式（clone、new、local），以及通过 `cleanupTask()` 实现的级联删除。 |
| [tasks-architecture](architecture/tasks-architecture.md) | 任务（Tasks）如何提供 git 工作树（worktree）隔离，以及手动触发的初始化流水线（pending -> init -> research -> ready）。涵盖状态门控、服务商必填要求、清理逻辑（通过 `git -C` 删除工作树和分支，回退使用 `rmSync` + prune）、可配置提示模板、任务详情页（删除按钮、描述截断+弹窗、带虚线边框卡片的待处理命令编辑、排队取消用 Undo2、运行中中止用 Square、通过客户端映射显示服务商名称、用于模式/草稿切换的 ToggleGroup、失败时 toast.error 提示），草稿创建绕过运行中命令检查，以及创建任务弹窗长内容支持。 |
| [commands-scheduler-architecture](architecture/commands-scheduler-architecture.md) | 命令执行流水线：基于优先级的调度、并发控制、基于模式的 CLI 标志（`--permission-mode plan` 用于 init/research/plan）、服务商环境注入、execEnv 审计、完整结果捕获（所有助手文本累积，result 事件作为兜底）、permission_denials 提取（AskUserQuestion -> markdown）、runner 后处理、命令列表中的 providerName、带吸底输入框的三段式详情页布局、详情页内联命令输入、待处理命令编辑/删除、排队取消（可恢复至 pending）、运行中止（终态）、基于 ToggleGroup 的工具栏（Exec/Plan、Draft/Queue）、toast 错误反馈，以及草稿创建绕过运行中命令检查。 |
| [providers-architecture](architecture/providers-architecture.md) | 服务商配置文件（Provider Profiles）：带自由格式环境键值对的命名配置，CRUD API、拖拽排序、运行时环境注入和敏感值脱敏。 |
| [mcp-feedback-loop](architecture/mcp-feedback-loop.md) | Claude 子进程与应用之间通过 Streamable HTTP（`/api/mcp`）实现的双向 MCP 桥接。涵盖 4 个 MCP 工具（create_task、update_command、get_task_context、list_tasks）的直接数据库访问、无状态传输和递归任务分解。 |

## 指南

| 文档 | 描述 |
|---|---|
| [managing-projects](guides/managing-projects.md) | 如何通过 REST API 创建、列出、获取和删除项目。删除操作现在使用 `cleanupTask()` 进行完整清理。 |
| [working-with-tasks](guides/working-with-tasks.md) | 任务生命周期：创建（pending）、手动带服务商初始化、两阶段流水线、后续命令、监控（描述截断+弹窗），以及删除（UI 删除按钮带确认，跳转至项目页）。所有操作都需要服务商。 |
| [dispatching-commands](guides/dispatching-commands.md) | 完整命令生命周期：创建（含服务商、通过 ToggleGroup 切换排队/草稿模式）、入队、执行、监控、查看 execEnv、从详情页派发后续命令（跳转至任务页）、重排优先级、中止（仅运行中）、取消排队（可恢复至 pending）、编辑待处理命令（提示/模式/服务商）以及删除待处理命令。草稿创建绕过运行中命令检查。 |
| [mcp-integration](guides/mcp-integration.md) | 如何配置、扩展和调试 MCP 集成（添加新工具、设置 API_BASE、读取日志）。 |

## 参考

| 文档 | 描述 |
|---|---|
| [config-keys](reference/config-keys.md) | 所有运行时配置键：调度参数（max_concurrent、poll_interval、command_timeout）、提示模板（init_prompt、research_prompt）以及 API 验证规则。 |
| [coding-conventions](reference/coding-conventions.md) | 项目编码规范：Next.js 16、TypeScript strict 模式、pnpm、Tailwind v4、shadcn/ui、Drizzle ORM + SQLite、Zod 验证、@dnd-kit、zh-CN 界面语言、sonner toast 错误处理、shadcn 组件使用规则、移动端优先交互要求。 |
| [git-conventions](reference/git-conventions.md) | Git 工作流：单 main 分支、基于工作树的任务隔离、Conventional Commits 格式、cleanupTask() 使用 `git -C` 上下文和回退机制的四步工作树+分支删除。 |
| [command-state-machine](reference/command-state-machine.md) | 命令的完整状态转换规则：6 个状态（pending、queued、running、completed、failed、aborted），带强制转换映射表。abort 仅可从 running 发起（终态）。排队取消返回 pending（可恢复）。待处理命令可编辑和删除。命令需要 providerId。 |
