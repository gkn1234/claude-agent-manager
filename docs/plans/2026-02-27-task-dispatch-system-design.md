# Claude Code 远程任务派发系统 — 设计方案

## 1. 概述

一个 Web 应用，支持通过手机远程向 ECS 上的 Claude Code 派发任务并监控状态。

### 使用场景

- 单用户自用，部署在一台 ECS (2U2G) 上
- 移动端优先，手机高频使用
- 最多 2-3 个 Claude Code 实例并发（可配置）

### 核心原则

- 所有原子操作通过 API 完成，不耦合 UI，方便 LLM 驱动
- 移动端优先的响应式设计
- 简单务实，不过度工程化

## 2. 系统架构

```
┌─────────────────────────────────────────────┐
│  ECS 2U2G                                   │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Next.js (全栈)                      │    │
│  │  ├── 前端：React + shadcn + Tailwind │    │
│  │  ├── API Routes：REST API           │    │
│  │  ├── 进程管理：spawn claude -p       │    │
│  │  └── MCP Server (内嵌)              │    │
│  └──────────┬──────────────────────────┘    │
│             │                               │
│  ┌──────────▼──────────┐                    │
│  │  SQLite              │                    │
│  │  ├── projects        │                    │
│  │  ├── tasks           │                    │
│  │  ├── commands        │                    │
│  └─────────────────────┘                    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Claude Code 实例 (最多 2-3 个)      │    │
│  │  ├── 实例 1: .worktrees/task-xxx    │    │
│  │  └── 实例 2: .worktrees/task-yyy    │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 技术选型

| 层 | 技术 |
|----|------|
| 全栈框架 | Next.js |
| 前端 UI | shadcn + Tailwind CSS，响应式布局 |
| 持久化 | SQLite |
| AI 集成 | MCP Server（供 Claude Code 调用系统 API） |
| 实时推送 | SSE（Server-Sent Events） |
| 进程管理 | Next.js API Route 内 child_process.spawn |

### 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 会话策略 | 始终 resume | 插件每次加载文档，独立会话无 token 优势 |
| PROGRESS.md | 不使用 | hooks 记忆系统 + SQLite 状态已足够 |
| 进程管理 | Next.js 直接管理 | 单用户场景，省资源，SQLite 持久化做故障恢复 |
| 监控粒度 | 状态+结果为主 | 完整日志存文件，按需懒加载 |
| 首页布局 | 纵向列表视图 | 移动端体验更好 |
| 优先级队列 | 全局队列 | 跨项目统一调度 |
| Worktree 创建 | Claude Code 执行 | 支持 AI 自主拆分任务 |

## 3. 概念模型

### 三层结构：项目 → 任务 → 指令

- **项目**：基于 Git 仓，划分工作空间
- **任务**：项目中的一项工作，拥有独立的 git worktree
- **指令**：推进任务的每一轮 AI 交互

## 4. 数据模型

### projects 表

```sql
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  work_dir   TEXT NOT NULL,       -- 本地工作目录绝对路径
  git_remote TEXT,                -- 远程 git 地址（可选）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### tasks 表

```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  description  TEXT NOT NULL,
  branch       TEXT,              -- worktree 分支名
  worktree_dir TEXT,              -- worktree 工作目录
  status       TEXT DEFAULT 'initializing',
               -- initializing / ready / archived
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### commands 表

```sql
CREATE TABLE commands (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  prompt      TEXT NOT NULL,      -- 发送给 Claude 的 prompt
  mode        TEXT DEFAULT 'execute', -- plan / execute
  status      TEXT DEFAULT 'pending',
              -- pending / queued / running / completed / failed / aborted
  priority    INTEGER DEFAULT 0,  -- 越大越优先
  result      TEXT,               -- Claude 最终输出（markdown）
  log_file    TEXT,               -- stream-json 日志文件路径
  session_id  TEXT,               -- Claude 会话 ID（用于 resume）
  pid         INTEGER,            -- Claude 进程 PID
  started_at  DATETIME,
  finished_at DATETIME,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 5. API 设计

### REST API

```
# 项目
POST   /api/projects              -- 创建项目
GET    /api/projects              -- 项目列表
GET    /api/projects/:id          -- 项目详情
DELETE /api/projects/:id          -- 删除项目（危险操作）

# 任务
POST   /api/projects/:id/tasks    -- 创建任务（触发初始化指令）
GET    /api/tasks                 -- 任务列表（支持 project_id 过滤）
GET    /api/tasks/:id             -- 任务详情
DELETE /api/tasks/:id             -- 删除任务（清理 worktree）

# 指令
POST   /api/tasks/:id/commands    -- 创建指令
GET    /api/commands              -- 全局指令列表（首页队列）
GET    /api/commands/:id          -- 指令详情
GET    /api/commands/:id/logs     -- 获取完整日志（懒加载）
PATCH  /api/commands/:id          -- 更新（调优先级、中止等）
PATCH  /api/commands/reorder      -- 批量调整优先级

# 系统
GET    /api/system/status         -- 系统状态（并发槽位、资源）
GET    /api/system/config         -- 系统配置
PATCH  /api/system/config         -- 更新配置
GET    /api/events                -- SSE 事件流（状态变更推送）
```

### MCP Server Tools

供 Claude Code 在执行任务时调用：

| Tool | 用途 |
|------|------|
| `create_task` | 创建子任务（AI 自主拆分场景） |
| `update_command` | 更新指令状态 |
| `get_task_context` | 获取任务上下文信息 |
| `list_tasks` | 列出当前项目的任务 |

## 6. 核心流程

### 6.1 创建项目

```
用户 → 选择方式（本地已有 / git clone / 新建）
  ├── 本地：选择已有目录，验证是 git 仓
  ├── clone：输入 git URL → git clone → 等待完成
  └── 新建：输入名称 → mkdir + git init
→ 写入 SQLite
→ 确保 .gitignore 包含 .worktrees/
```

### 6.2 创建任务

```
用户 → 输入任务描述
→ 写入 SQLite (status=initializing)
→ 自动创建"初始化指令"：
  prompt = "基于以下任务描述，在 .worktrees/ 下创建 git worktree
            作为工作空间。理解项目结构，如果任务过大请通过
            MCP create_task 拆分为多个子任务。
            任务描述：{description}"
→ 初始化指令入队 → 调度器执行
→ Claude Code 完成初始化 → task.status = ready
```

### 6.3 指令执行

```
调度器（每 5 秒轮询）：
1. 查询 running 状态的指令数 < max_concurrent？
2. 是 → 取 queued/pending 中 priority 最高的指令
3. 组装命令：
   claude -p "{prompt}" \
     --dangerously-skip-permissions \
     --output-format stream-json \
     --verbose \
     --resume {session_id}       # 同任务有历史时
4. cwd = task.worktree_dir
5. spawn 子进程，记录 PID
6. 逐行解析 stream-json → 写入日志文件
7. 完成 → 提取最终 result → 存 SQLite
8. 保存 session_id 供后续 resume
```

### 6.4 中止指令

```
用户 → PATCH /api/commands/:id {status: "aborted"}
→ kill -SIGTERM {pid}
→ 等待 5 秒 → 如果还活着 → kill -9
→ 更新 SQLite 状态
```

## 7. 前端页面

### 页面结构

| 页面 | 路由 | 说明 |
|------|------|------|
| 首页 | `/` | 全局指令队列（纵向列表） |
| 项目列表 | `/projects` | 项目卡片列表 |
| 项目详情 | `/projects/:id` | 项目信息 + 任务列表 |
| 任务视图 | `/tasks/:id` | 任务信息 + 历史指令时间线 + 派发指令 |
| 指令详情 | `/commands/:id` | 指令结果 + 日志查看 |
| 设置 | `/settings` | 系统配置 |

### 导航

- 手机端：底部 Tab Bar（首页、项目、设置）
- 桌面端：侧边栏导航

### 首页 — 指令队列

- 纵向列表，按状态分组（进行中 / 排队中 / 已完成）
- 进行中：始终展开
- 排队中：默认展开，支持长按拖拽调整优先级
- 已完成：默认折叠
- 支持项目、任务过滤器（过滤后禁用拖拽）
- 卡片显示：项目/任务名、prompt 摘要、状态、时间

### 任务视图

- 任务元信息（描述、分支、worktree 路径）
- 历史指令时间线（纵向排列）
- 底部输入框 + 发送按钮
- 有进行中指令时输入框禁用

## 8. 故障处理

### 服务重启恢复

1. 查询 `commands` 表中 `status = 'running'` 的指令
2. 检查对应 PID 是否存活
3. 已死 → 标记为 `failed`，result = "服务重启导致中断"
4. 还活着 → kill 掉，标记为 `aborted`

### 进程异常

- 退出码非 0 → `failed`，stderr 写入 result
- 超时（默认 30 分钟）→ kill + `failed`
- 输出解析失败 → 原始输出存日志，result 标记异常

### 约束

- 同一任务不可同时有两条 running 指令
- worktree 目录不存在时 task.status 标记为 error

## 9. 系统配置

| 配置项 | 默认值 | 说明 |
|--------|-------|------|
| `max_concurrent` | 2 | 最大并发 Claude 实例数 |
| `command_timeout` | 1800s | 指令超时时间 |
| `log_retention_days` | 30 | 日志保留天数 |
| `poll_interval` | 5s | 调度器轮询间隔 |

## 10. 未决项

- Claude Code 的 `--resume` 在 `-p` 模式下的具体参数格式需要验证
- MCP Server 与 Next.js 的集成方式（内嵌 vs 独立进程）
- 项目目录选择在 Web UI 中的实现方式（可能需要后端列出目录）
- 认证方案（单用户场景可以用简单的 token 或 basic auth）
