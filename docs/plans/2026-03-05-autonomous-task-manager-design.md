# Autonomous Task Manager 设计文档

> 日期: 2026-03-05
> 状态: 已批准

## 概述

将 Claude Dispatch 从"人工派发指令"模式进化为"自主 Agent 编排"模式。用户只需给出高层目标或设计文档，系统中的 Manager（任务管理器）自动拆解、派发、审查、迭代，直到目标完成。用户全程可见每一步操作，随时可介入切换为手动模式或恢复自主模式。

### 核心设计原则

- **编排逻辑 100% 在 MCP 工具中**：Manager/Worker 通过 MCP 工具驱动循环，调度器只负责按规则执行命令
- **MCP 层角色隔离**：通过 URL 参数区分角色，不同角色看到不同工具集，不依赖提示词约束
- **MCP 层上下文注入**：commandId、taskId、providerId 等由 MCP 层自动注入，不依赖 LLM 传参
- **最小安全网**：调度器仅新增循环中断检测（约 10 行），防止 Worker/Manager 崩溃导致任务静默停滞

## 核心概念

### 两种角色的命令

| 角色 | 职责 | Session |
|------|------|---------|
| Manager | 分析目标、规划、审查结果、派发工作命令 | 独立 session，贯穿任务生命周期（通过 resume 保持上下文） |
| Worker | 执行具体工作（写代码、测试、调试等） | 独立 session（或 resume 前序 worker session） |

Manager 和 Worker 都是 Claude CLI 进程，通过现有的命令队列和调度器执行，不常驻。

### MCP 驱动的工作流

```
用户启用自主模式（选择目标 + Manager/Worker Provider）
  ↓
API 创建第一条 manager 命令（初始提示词 + 目标）
  ↓
调度器执行 manager → Manager 分析代码库，制定计划
  ↓
Manager 通过 MCP create_command 派发 worker 命令 → Manager 退出
  ↓
调度器执行 worker → Worker 执行具体工作
  ↓
Worker 通过 MCP report_to_manager 汇报 → MCP 自动创建下一条 manager 命令 → Worker 退出
  ↓
调度器执行 manager（resume session）→ 审查 Worker 报告
  ↓
Manager 决策:
  - create_command → 派发新 worker（循环继续）
  - complete_task → 标记任务完成，切为 manual
  - pause_task → 暂停，等待用户确认，切为 manual
  ↓
循环...
```

**关键：调度器全程只做"取队列头命令 → 执行"，不解析输出、不创建命令、不判断状态。**

## 数据模型变更

### Task 新增字段

```typescript
// schema.ts - tasks 表
mode: text('mode').default('manual'),                    // 'manual' | 'autonomous'
goal: text('goal'),                                       // 高层目标或设计文档内容
managerSessionId: text('manager_session_id'),             // manager 的 Claude CLI session ID
managerProviderId: text('manager_provider_id'),           // manager 使用的 Provider（启用时固定）
workerProviderId: text('worker_provider_id'),             // worker 使用的 Provider（启用时固定）
autonomousRound: integer('autonomous_round').default(0),  // 当前轮次计数（用于限制最大循环）
```

### Command 新增字段

```typescript
// schema.ts - commands 表
role: text('role').default('worker'),            // 'worker' | 'manager'
managerSummary: text('manager_summary'),         // worker 通过 MCP report_to_manager 写入的摘要
```

## MCP 层架构

### 带上下文的 MCP 端点

调度器根据命令角色，为 Claude CLI 配置不同的 MCP URL：

```
Manager: /api/mcp?commandId=cmd_123&taskId=task_456&role=manager
Worker:  /api/mcp?commandId=cmd_789&taskId=task_456&role=worker
手动:    /api/mcp（无参数，保持现有行为）
```

### 角色工具可见性

MCP 服务器根据 URL 参数的 `role` 动态注册工具：

| 工具 | manual | Manager | Worker | 说明 |
|------|--------|---------|--------|------|
| create_command | ❌ | ✅ | ❌ | 派发工作命令 |
| complete_task | ❌ | ✅ | ❌ | 标记任务完成 |
| pause_task | ❌ | ✅ | ❌ | 暂停等待用户 |
| report_to_manager | ❌ | ❌ | ✅ | 向 Manager 汇报 |
| create_task | ✅ | ✅ | ❌ | 创建子任务 |
| update_command | ✅ | ✅ | ✅ | 更新命令状态 |
| get_task_context | ✅ | ✅ | ✅ | 获取任务上下文 |
| list_tasks | ✅ | ✅ | ✅ | 列出项目任务 |

Worker **看不到** `create_command`，这是结构化隔离，不依赖提示词约束。

### 上下文自动注入

MCP 层从 URL 参数读取上下文，自动填充工具参数，LLM 无需手动传递：

```
Worker 调用: report_to_manager({ summary: "完成了 X" })
  → MCP 自动注入: commandId（从 URL params）

Manager 调用: create_command({ prompt: "实现 Y", mode: "execute" })
  → MCP 自动注入: taskId（从 URL params）、providerId（从 task.workerProviderId）

Manager 调用: complete_task({})
  → MCP 自动注入: taskId（从 URL params）
```

### 实现方式

```typescript
// route.ts
function createServer(context: {
  role: 'manager' | 'worker' | 'manual',
  commandId?: string,
  taskId?: string,
}): McpServer {
  const server = new McpServer({ name: 'dispatch-system', version: '1.0.0' });

  // 根据 role 注册不同工具集
  if (context.role === 'manager') {
    registerManagerTools(server, context);   // create_command, complete_task, pause_task
  }
  if (context.role === 'worker') {
    registerWorkerTools(server, context);    // report_to_manager
  }

  // 所有角色共享的工具
  registerSharedTools(server, context);      // get_task_context, list_tasks, update_command

  // manual 模式额外注册 create_task（manager 也有）
  if (context.role === 'manual' || context.role === 'manager') {
    registerCreateTask(server);
  }

  return server;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const role = (url.searchParams.get('role') || 'manual') as 'manager' | 'worker' | 'manual';
  const commandId = url.searchParams.get('commandId') ?? undefined;
  const taskId = url.searchParams.get('taskId') ?? undefined;

  const server = createServer({ role, commandId, taskId });
  // ...transport handling
}
```

## MCP 工具设计

### create_command（Manager 专用）

Manager 用于派发工作命令。

```typescript
create_command({
  prompt: string,         // 工作指令
  mode: string,           // 'execute' | 'plan'
})
// taskId: 从 MCP 上下文自动注入
// providerId: 从 task.workerProviderId 自动注入
// 创建 status='queued', role='worker' 的命令
// 直接操作数据库，不经过 REST API，不受 409 running 检查限制
// Worker prompt 末尾自动追加 report_to_manager 指引
```

### report_to_manager（Worker 专用）

Worker 用于向 Manager 发送结构化摘要，并自动触发下一轮 Manager 审查。

```typescript
report_to_manager({
  summary: string,        // 结构化摘要（做了什么、结果、建议下一步）
})
// commandId: 从 MCP 上下文自动注入
// 执行逻辑:
//   1. 写入 command.managerSummary
//   2. 检查 task.mode:
//      - 'autonomous' → task.autonomousRound += 1，创建 manager 审查命令（resume session）
//      - 'manual' → 不创建 manager 命令，静默返回
//   3. 检查轮次限制:
//      - if autonomousRound > MAX_ROUNDS → task.mode = 'manual'，不创建命令
```

### complete_task（Manager 专用）

Manager 用于宣告目标完成。

```typescript
complete_task({
  summary: string,        // 完成摘要
})
// taskId: 从 MCP 上下文自动注入
// 执行逻辑:
//   1. task.mode = 'manual'
//   2. 记录完成摘要
```

### pause_task（Manager 专用）

Manager 用于暂停任务，等待用户确认或决策。

```typescript
pause_task({
  reason: string,         // 暂停原因和需要用户确认的内容
})
// taskId: 从 MCP 上下文自动注入
// 执行逻辑:
//   1. task.mode = 'manual'
//   2. 记录暂停原因
```

### 现有工具保持不变

- `create_task`: 创建子任务
- `update_command`: 更新命令状态
- `get_task_context`: 获取任务上下文
- `list_tasks`: 列出项目任务

## 调度器变更

### 唯一改动：安全网（循环中断检测）

在命令完成/失败/中止回调中新增约 10 行代码：

```
命令完成/失败/中止时:
  if task.mode === 'autonomous':
    延迟 3 秒后检查（给 MCP report_to_manager 调用留出窗口）:
      if 该任务无 queued/running 命令:
        创建 fallback manager 命令:
          - role: 'manager'
          - session: resume task.managerSessionId
          - prompt: fallback 审查提示词 + command.result 截前 4000 字符
          - providerId: task.managerProviderId
          - mode: 'plan'
          - status: 'queued'
```

**触发条件**：Worker/Manager 崩溃、超时被 abort、或未调用任何 MCP 工具就退出。
**正常流程不触发**：因为 report_to_manager/create_command 会在命令完成前创建后续命令。

### Manager 命令的运行配置

- **工作模式**: `plan`（只读代码，不写文件）
- **工作目录**: 与 worker 相同（task.worktreeDir）
- **MCP**: `/api/mcp?commandId={id}&taskId={taskId}&role=manager`

### Worker 命令的运行配置

- **工作模式**: 由 Manager 在 create_command 中指定（execute 或 plan）
- **工作目录**: task.worktreeDir
- **MCP**: `/api/mcp?commandId={id}&taskId={taskId}&role=worker`

## 提示词设计

### Manager 初始提示词（首次启动）

```
你是 Claude Dispatch 任务管理器（Manager）。你的职责是自主推进目标的完成。

## 任务目标
{task.goal}

## 当前工作环境
- 项目: {project.name}
- 工作目录: {task.worktreeDir}
- 分支: {task.branch}

## 可用 MCP 工具
- create_command: 派发工作命令（指定 prompt 和 mode）
- complete_task: 宣告目标完成（附完成摘要）
- pause_task: 暂停任务，请求用户确认（附暂停原因）
- get_task_context: 获取任务上下文和命令历史
- list_tasks: 列出项目下所有任务

## 工作方式
1. 先分析代码库和目标，制定实施计划
2. 将计划拆解为工作命令，通过 create_command 逐个派发
3. 工作命令会由独立的 Claude CLI 进程在同一工作目录执行
4. 你不需要直接写代码，只需要规划和派发
5. 每次回复结束前，你必须调用一个 MCP 工具

## 注意事项
- 每次只派发一个 worker 命令，等待其完成后再决定下一步
- 你调用 create_command 后即可结束回复，系统会自动安排执行
- Worker 完成后你会收到其报告，届时再审查并决定下一步
```

### Manager 审查提示词（resume session）

```
以下工作命令已完成，请审查结果并决定下一步。

## Worker 报告
{command.managerSummary 或 command.result 截前 4000 字符}

## 命令信息
- Prompt: {command.prompt}
- 状态: {command.status}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 如果命令失败：分析原因，决定重试或调整策略
6. 每次回复结束前，你必须调用一个 MCP 工具
```

### Worker 补充提示词

Manager 通过 create_command 派发的 worker 命令 prompt 末尾自动追加（由 MCP 工具完成，非提示词注入）：

```
完成工作后，使用 report_to_manager 工具向管理器报告：
- 完成了什么
- 结果如何
- 是否遇到问题
- 建议的下一步
```

## 用户介入机制

### 模式切换

- **手动 → 自主**: 用户在任务详情页点击"启动自主模式"，选择 Manager Provider 和 Worker Provider，填写目标，API 创建首条 manager 命令
- **自主 → 手动**: 用户点击"暂停自主模式"，task.mode 切为 manual，MCP 工具检查 mode 后不再创建后续命令
- **恢复**: 用户点击"恢复自主模式"（Provider 不可变），API 创建新的 manager 审查命令（resume session + 最近命令摘要）

### Provider 配置

- Manager Provider 和 Worker Provider 在**启用自主模式时固定**
- 暂停后恢复不可更改（除非暂停后重新启用）
- Manager 通过 create_command 派发 worker 时，providerId 由 MCP 自动从 task.workerProviderId 注入，Manager 无需选择

### 干预

- 用户在 autonomous 模式下仍可手动添加/编辑/删除命令
- 手动添加的命令 role 为 worker，正常进入队列
- Manager 下次审查时会通过 get_task_context 看到所有命令历史

## UI 变更

### 任务详情页

- 新增模式切换按钮（手动/自主）
- 启用自主模式对话框：目标输入 + Manager Provider 选择 + Worker Provider 选择
- 自主模式下显示当前状态（运行中/等待审查/已完成/需确认）
- 显示当前轮次（autonomousRound / MAX_ROUNDS）

### 命令列表

- Manager 命令用不同图标/颜色区分（如紫色/脑图标）
- Worker 命令保持现有样式
- Manager 命令展开后显示决策过程

## 并发策略

- **同一任务内**: 严格串行（复用现有调度器逻辑）
- **跨任务**: 并行（受 max_concurrent 限制）
- **并行工作**: 本期不支持 Manager 创建子任务实现并行，未来版本设计跨任务通信方案

## 边界情况

| 场景 | 处理 |
|------|------|
| Worker 崩溃/未调用 report_to_manager | 安全网触发：3 秒后检测到无后续命令，创建 fallback manager 命令（含 truncated result） |
| Manager 崩溃/未调用任何 MCP 工具 | 安全网触发：同上逻辑 |
| Worker 超时被 abort | 安全网覆盖 aborted 状态，创建 fallback manager 命令（Manager 可决定重试或调整） |
| 循环次数超限 | report_to_manager 检查 autonomousRound > MAX_ROUNDS，自动切为 manual |
| 用户在 autonomous 模式下手动添加命令 | 正常排队，Manager 下次审查时可通过 get_task_context 可见 |
| 用户切为 manual 时 Worker 仍在运行 | Worker 调用 report_to_manager 时检查 task.mode，manual 下只存摘要不创建 manager 命令 |
| Manager session 上下文过长 | 通过 Claude CLI 的自动压缩机制处理 |

## 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| max_autonomous_rounds | 20 | 单次自主模式最大循环轮次 |
| safety_net_delay_ms | 3000 | 安全网检查延迟（毫秒） |

## 实现优先级

1. **Phase 1: 数据模型** - schema 变更 + db:push
2. **Phase 2: MCP 层** - 角色隔离、上下文注入、4 个新工具
3. **Phase 3: 调度器安全网** - 循环中断检测
4. **Phase 4: 任务 API** - 模式切换端点
5. **Phase 5: UI** - 模式切换、目标输入、Provider 选择、Manager 命令样式
6. **Phase 6: 提示词** - Manager/Worker 提示词模板
