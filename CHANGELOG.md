# Changelog

## [1.0.1] - 2026-03-05

### Features

- 任务创建支持基准分支选择（`baseBranch` 参数，默认 main）
- MCP `create_task` 工具同步支持 `baseBranch` 参数

### Bug Fixes

- 修复 git clone 同步阻塞服务器问题（改为异步 + 120s 超时 + 失败清理）
- 修复 git clone 错误无友好提示问题（解析 stderr fatal 行返回 JSON 响应）
- 修复部署流水线缺少数据库同步步骤（新增 db:push）
- 修复部署脚本自更新导致执行中断（main() 函数包裹）

### Refactoring

- 抽取 `createTask()` 共享函数（`src/lib/tasks.ts`），REST API 和 MCP 工具复用
- 登出按钮从导航迁移到设置页

### Documentation

- 新增 API 与 MCP 同步原则
- 新增子进程执行规范（网络 git 操作必须异步 + 超时）
- 新增数据库 schema 变更规范
- deploy.sh 流水线升级为 7 步（含 db:push）

## [1.0.0] - 2026-03-04

Claude Dispatch v1.0.0 首个正式版本发布。这是一个用于远程向 Claude Code CLI 进程派发任务的 Next.js 应用，具备实时监控、服务商配置、MCP 反馈循环和单密码认证保护。

### Features

- **项目管理**: 支持 clone、new、local 三种创建模式，git 集成，级联删除清理
- **任务系统**: 原子创建（同步创建 git branch + worktree），无 status 字段，创建即就绪
- **命令调度**: 基于优先级的调度器、并发控制、基于模式的 CLI 标志、完整结果捕获、permission_denials 提取
- **服务商配置文件 (Provider Profiles)**: 命名配置带自由格式环境键值对、拖拽排序、运行时环境注入、敏感值脱敏
- **MCP 反馈循环**: Claude 子进程与应用之间通过 Streamable HTTP 实现双向 MCP 桥接，支持 4 个工具（create_task、update_command、get_task_context、list_tasks）
- **单密码认证**: HMAC-SHA256 签名 Cookie、Next.js middleware 路由拦截、Edge Runtime 兼容
- **语音输入**: 命令输入支持语音录入
- **草稿/队列模式**: 命令创建支持草稿模式切换，待处理命令可编辑和删除
- **配置系统**: 数据库动态配置（max_concurrent、poll_interval、command_timeout、log_retention_days）+ 环境变量，支持运行时热重载
- **设置页面**: Tabs 分区（Provider 配置 + 系统参数），Provider 卡片支持折叠/展开
- **响应式导航**: 底部 Tab 栏（移动端）+ 侧边栏（桌面端）
- **SSE 实时事件**: 命令状态变更实时推送
- **命令详情**: 内联命令输入、execEnv 审计、Markdown 渲染、代码高亮

### Bug Fixes

- 修复命令注入、定时器泄漏、状态机等关键安全问题
- 修复 Next.js standalone 模式下静态资源缺失问题
- 修复 Tailwind v4 Button 组件 cursor-pointer 兼容性
- 修复 MCP 服务器弃用 API 警告（迁移至 registerTool）
- 统一 command_timeout 和 poll_interval 使用配置系统

### Refactoring

- 从 npm 迁移至 pnpm
- MCP 服务器从 stdio 迁移至 Streamable HTTP
- 任务创建简化为原子操作（branch + worktree）
- middleware.ts 重命名为 proxy.ts 适配 Next.js 15+ 规范
- 部署脚本简化

### Deployment

- systemd 管理的 Next.js standalone 模式
- EC2 环境初始化脚本（支持 OpenCloudOS / RHEL）
- deploy.sh 6 步部署流水线（含静态资源复制）

### Documentation

- 完整的 llmdoc 文档系统（概述、架构、指南、参考）
- 全部文档中文化
