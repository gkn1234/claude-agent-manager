# llmdoc 索引

Claude Dispatch 文档的 LLM 智能体导航入口。请按顺序阅读文档：先阅读概述，再阅读架构，最后按需阅读指南/参考。

## 概述

| 文档 | 描述 |
|---|---|
| [project-overview](overview/project-overview.md) | Claude Dispatch 是什么：一个用于远程向 Claude Code CLI 进程派发任务的 Next.js 应用，具备实时监控、服务商配置文件（Provider Profiles）和 MCP 反馈循环。涵盖系统定位、技术栈、实体层级（项目 -> 任务 -> 命令，服务商）及关键模式。任务创建为原子操作（同步创建 git branch + worktree），无 status 字段。 |

## 架构

| 文档 | 描述 |
|---|---|
| [projects-architecture](architecture/projects-architecture.md) | 项目（Projects）实体的工作方式：数据模式、API 路由、git 工具函数、三种创建模式（clone、new、local），以及通过 `cleanupTask()` 实现的级联删除。 |
| [tasks-architecture](architecture/tasks-architecture.md) | 任务（Tasks）如何通过原子创建（同步 git branch + worktree）提供工作树隔离。无 status 字段，创建即就绪。涵盖分支名格式验证（`[a-z0-9-]`）、自动生成（`task-{uuid前缀}`）、清理逻辑（通过 `git -C` 删除工作树和分支）、共享 `CommandInput` 组件（provider 选择、mode 切换、draft/queue 模式、语音输入）、任务详情页（删除按钮、分支名显示、待处理命令编辑、排队取消、运行中止）和创建任务对话框（任务名 + 分支名）。 |
| [commands-scheduler-architecture](architecture/commands-scheduler-architecture.md) | 命令执行流水线：基于优先级的调度、并发控制、基于模式的 CLI 标志（`--permission-mode plan`）、服务商环境注入、execEnv 审计、完整结果捕获、permission_denials 提取、共享 `CommandInput` 组件（任务详情页和命令详情页共用，含语音输入能力）、待处理命令编辑/删除、排队取消、运行中止、toast 错误反馈，以及草稿创建绕过运行中命令检查。 |
| [providers-architecture](architecture/providers-architecture.md) | 服务商配置文件（Provider Profiles）：带自由格式环境键值对的命名配置，CRUD API、拖拽排序、运行时环境注入和敏感值脱敏。 |
| [mcp-feedback-loop](architecture/mcp-feedback-loop.md) | Claude 子进程与应用之间通过 Streamable HTTP（`/api/mcp`）实现的双向 MCP 桥接。涵盖 4 个 MCP 工具（create_task、update_command、get_task_context、list_tasks）的直接数据库访问、无状态传输和递归任务分解。 |

## 指南

| 文档 | 描述 |
|---|---|
| [managing-projects](guides/managing-projects.md) | 如何通过 REST API 创建、列出、获取和删除项目。删除操作现在使用 `cleanupTask()` 进行完整清理。 |
| [working-with-tasks](guides/working-with-tasks.md) | 任务生命周期：原子创建（任务名 + 可选分支名，同步生成 git branch + worktree）、添加命令、监控、删除。无初始化流程，创建即就绪。 |
| [dispatching-commands](guides/dispatching-commands.md) | 完整命令生命周期：创建（含服务商、通过 CommandInput 组件切换排队/草稿模式）、入队、执行、监控、查看 execEnv、从详情页派发后续命令、重排优先级、中止、取消排队、编辑待处理命令以及删除待处理命令。 |
| [mcp-integration](guides/mcp-integration.md) | 如何配置、扩展和调试 MCP 集成（添加新工具、设置 API_BASE、读取日志）。 |

## 参考

| 文档 | 描述 |
|---|---|
| [config-keys](reference/config-keys.md) | 所有运行时配置键：调度参数（max_concurrent、poll_interval、command_timeout、log_retention_days）和 API 验证规则。init_prompt 和 research_prompt 已移除。 |
| [coding-conventions](reference/coding-conventions.md) | 项目编码规范：Next.js 16、TypeScript strict 模式、pnpm、Tailwind v4、shadcn/ui、Drizzle ORM + SQLite、Zod 验证、@dnd-kit、zh-CN 界面语言、sonner toast 错误处理、shadcn 组件使用规则、移动端优先交互要求。 |
| [git-conventions](reference/git-conventions.md) | Git 工作流：单 main 分支、基于工作树的任务隔离、Conventional Commits 格式、cleanupTask() 使用 `git -C` 上下文和回退机制的四步工作树+分支删除。 |
| [command-state-machine](reference/command-state-machine.md) | 命令的完整状态转换规则：6 个状态（pending、queued、running、completed、failed、aborted），带强制转换映射表。abort 仅可从 running 发起（终态）。排队取消返回 pending（可恢复）。待处理命令可编辑和删除。命令需要 providerId。 |
