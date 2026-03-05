# Phase 2: MCP 层角色隔离与新工具 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构 MCP route，实现角色隔离（Manager/Worker/Manual）、上下文自动注入、4 个新工具（create_command, report_to_manager, complete_task, pause_task）。

**Architecture:** 将 `createServer()` 改为接收 `context` 参数，根据 URL query params 中的 `role`/`commandId`/`taskId` 动态注册不同工具集。工具函数抽取到独立模块 `src/lib/mcp-tools/`，MCP route 保持薄层。所有工具直接操作数据库，不经过 REST API。

**Tech Stack:** @modelcontextprotocol/sdk, Drizzle ORM + SQLite, Zod, Vitest

**Design Doc:** `docs/plans/2026-03-05-autonomous-task-manager-design.md` → "MCP 层架构" 和 "MCP 工具设计" 章节

---

## Task 1: 抽取 MCP 工具上下文类型与工具注册架构

**Files:**
- Create: `src/lib/mcp-tools/types.ts`
- Create: `src/lib/mcp-tools/index.ts`
- Test: `src/lib/__tests__/mcp-context.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/mcp-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMcpContext } from '../mcp-tools';

describe('parseMcpContext', () => {
  it('should parse manual context when no params', () => {
    const ctx = parseMcpContext(new URLSearchParams());
    expect(ctx.role).toBe('manual');
    expect(ctx.commandId).toBeUndefined();
    expect(ctx.taskId).toBeUndefined();
  });

  it('should parse manager context', () => {
    const ctx = parseMcpContext(new URLSearchParams('role=manager&commandId=cmd-1&taskId=task-1'));
    expect(ctx.role).toBe('manager');
    expect(ctx.commandId).toBe('cmd-1');
    expect(ctx.taskId).toBe('task-1');
  });

  it('should parse worker context', () => {
    const ctx = parseMcpContext(new URLSearchParams('role=worker&commandId=cmd-2&taskId=task-2'));
    expect(ctx.role).toBe('worker');
    expect(ctx.commandId).toBe('cmd-2');
    expect(ctx.taskId).toBe('task-2');
  });

  it('should default to manual for unknown role', () => {
    const ctx = parseMcpContext(new URLSearchParams('role=unknown'));
    expect(ctx.role).toBe('manual');
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/mcp-context.test.ts
```

Expected: FAIL — `parseMcpContext` 不存在。

**Step 3: 创建类型定义和解析函数**

`src/lib/mcp-tools/types.ts`:

```typescript
export type McpRole = 'manager' | 'worker' | 'manual';

export interface McpContext {
  role: McpRole;
  commandId?: string;
  taskId?: string;
}
```

`src/lib/mcp-tools/index.ts`:

```typescript
export type { McpRole, McpContext } from './types';

export function parseMcpContext(params: URLSearchParams): McpContext {
  const rawRole = params.get('role');
  const role: McpContext['role'] =
    rawRole === 'manager' || rawRole === 'worker' ? rawRole : 'manual';
  const commandId = params.get('commandId') ?? undefined;
  const taskId = params.get('taskId') ?? undefined;
  return { role, commandId, taskId };
}
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/mcp-context.test.ts
```

Expected: ALL PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/mcp-tools/ src/lib/__tests__/mcp-context.test.ts
git commit -m "feat: add MCP context parsing with role isolation types"
```

---

## Task 2: 实现 create_command 工具（Manager 专用）

**Files:**
- Create: `src/lib/mcp-tools/manager-tools.ts`
- Create: `src/lib/__tests__/mcp-create-command.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/mcp-create-command.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands, providers } from '../schema';
import { eq } from 'drizzle-orm';

// We test the core logic function directly, not the MCP registration
import { executeCreateCommand } from '../mcp-tools/manager-tools';

describe('create_command (Manager tool)', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;

    db.insert(providers).values({
      id: 'prov-worker',
      name: 'Worker Provider',
      envJson: '{}',
    }).run();

    db.insert(projects).values({
      id: 'proj-1',
      name: 'Test Project',
      workDir: '/tmp/test',
    }).run();

    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test-branch',
      mode: 'autonomous',
      workerProviderId: 'prov-worker',
    }).run();
  });

  afterEach(() => {
    testEnv.sqlite.close();
  });

  it('should create a queued worker command', () => {
    const result = executeCreateCommand(testEnv.db, {
      taskId: 'task-1',
      prompt: 'Implement feature X',
      mode: 'execute',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.status).toBe('queued');
    expect(result.command.role).toBe('worker');
    expect(result.command.taskId).toBe('task-1');
    expect(result.command.providerId).toBe('prov-worker');
  });

  it('should auto-inject workerProviderId from task', () => {
    const result = executeCreateCommand(testEnv.db, {
      taskId: 'task-1',
      prompt: 'Do something',
      mode: 'execute',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.providerId).toBe('prov-worker');
  });

  it('should append report_to_manager instruction to prompt', () => {
    const result = executeCreateCommand(testEnv.db, {
      taskId: 'task-1',
      prompt: 'Build the login page',
      mode: 'execute',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.prompt).toContain('Build the login page');
    expect(result.command.prompt).toContain('report_to_manager');
  });

  it('should fail if task not found', () => {
    const result = executeCreateCommand(testEnv.db, {
      taskId: 'nonexistent',
      prompt: 'Something',
      mode: 'execute',
    });

    expect(result.ok).toBe(false);
  });

  it('should fail if task has no workerProviderId', () => {
    testEnv.db.update(tasks).set({ workerProviderId: null }).where(eq(tasks.id, 'task-1')).run();

    const result = executeCreateCommand(testEnv.db, {
      taskId: 'task-1',
      prompt: 'Something',
      mode: 'execute',
    });

    expect(result.ok).toBe(false);
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/mcp-create-command.test.ts
```

Expected: FAIL — `executeCreateCommand` 不存在。

**Step 3: 实现 manager-tools.ts**

`src/lib/mcp-tools/manager-tools.ts`:

```typescript
import { tasks, commands } from '../schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

type Db = Parameters<typeof import('drizzle-orm')['eq']> extends never[] ? never : any;

const WORKER_REPORT_INSTRUCTION = `

---

完成工作后，使用 report_to_manager 工具向管理器报告：
- 完成了什么
- 结果如何
- 是否遇到问题
- 建议的下一步`;

interface CreateCommandParams {
  taskId: string;
  prompt: string;
  mode: string;
}

type CreateCommandResult =
  | { ok: true; command: typeof commands.$inferSelect }
  | { ok: false; error: string };

export function executeCreateCommand(db: any, params: CreateCommandParams): CreateCommandResult {
  const { taskId, prompt, mode } = params;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    return { ok: false, error: `Task ${taskId} not found` };
  }

  if (!task.workerProviderId) {
    return { ok: false, error: 'Task has no workerProviderId configured' };
  }

  const commandId = uuid();
  const fullPrompt = prompt + WORKER_REPORT_INSTRUCTION;

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt: fullPrompt,
    mode: mode || 'execute',
    status: 'queued',
    role: 'worker',
    providerId: task.workerProviderId,
    priority: 0,
  }).run();

  const command = db.select().from(commands).where(eq(commands.id, commandId)).get()!;
  return { ok: true, command };
}
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/mcp-create-command.test.ts
```

Expected: ALL PASS (5 tests)

**Step 5: Commit**

```bash
git add src/lib/mcp-tools/manager-tools.ts src/lib/__tests__/mcp-create-command.test.ts
git commit -m "feat: implement create_command MCP tool for Manager role"
```

---

## Task 3: 实现 report_to_manager 工具（Worker 专用）

**Files:**
- Create: `src/lib/mcp-tools/worker-tools.ts`
- Create: `src/lib/__tests__/mcp-report-to-manager.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/mcp-report-to-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands, providers } from '../schema';
import { eq } from 'drizzle-orm';
import { executeReportToManager } from '../mcp-tools/worker-tools';

describe('report_to_manager (Worker tool)', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;

    db.insert(providers).values({ id: 'prov-mgr', name: 'Manager Prov', envJson: '{}' }).run();
    db.insert(providers).values({ id: 'prov-wkr', name: 'Worker Prov', envJson: '{}' }).run();

    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp/test' }).run();

    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test-branch',
      mode: 'autonomous',
      managerSessionId: 'session-mgr-1',
      managerProviderId: 'prov-mgr',
      workerProviderId: 'prov-wkr',
      autonomousRound: 0,
    }).run();

    db.insert(commands).values({
      id: 'cmd-worker-1',
      taskId: 'task-1',
      prompt: 'Do work',
      role: 'worker',
      status: 'running',
    }).run();
  });

  afterEach(() => {
    testEnv.sqlite.close();
  });

  it('should write managerSummary to current command', () => {
    executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: '完成了认证模块',
    });

    const cmd = testEnv.db.select().from(commands).where(eq(commands.id, 'cmd-worker-1')).get();
    expect(cmd?.managerSummary).toBe('完成了认证模块');
  });

  it('should increment autonomousRound on task', () => {
    executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: 'Done',
    });

    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.autonomousRound).toBe(1);
  });

  it('should create a manager review command when in autonomous mode', () => {
    const result = executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: 'Feature done',
    });

    expect(result.ok).toBe(true);
    expect(result.managerCommandCreated).toBe(true);

    const allCmds = testEnv.db.select().from(commands).all();
    const managerCmd = allCmds.find(c => c.role === 'manager');
    expect(managerCmd).toBeDefined();
    expect(managerCmd?.status).toBe('queued');
    expect(managerCmd?.providerId).toBe('prov-mgr');
    expect(managerCmd?.mode).toBe('plan');
  });

  it('should resume manager session in review command', () => {
    executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: 'Done',
    });

    const allCmds = testEnv.db.select().from(commands).all();
    const managerCmd = allCmds.find(c => c.role === 'manager');
    expect(managerCmd?.sessionId).toBe('session-mgr-1');
  });

  it('should NOT create manager command when task is in manual mode', () => {
    testEnv.db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, 'task-1')).run();

    const result = executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: 'Done in manual',
    });

    expect(result.ok).toBe(true);
    expect(result.managerCommandCreated).toBe(false);

    // Summary still saved
    const cmd = testEnv.db.select().from(commands).where(eq(commands.id, 'cmd-worker-1')).get();
    expect(cmd?.managerSummary).toBe('Done in manual');
  });

  it('should switch to manual and NOT create command when max rounds exceeded', () => {
    testEnv.db.update(tasks).set({ autonomousRound: 19 }).where(eq(tasks.id, 'task-1')).run();

    const result = executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: 'Done at limit',
    });

    expect(result.ok).toBe(true);
    expect(result.managerCommandCreated).toBe(false);

    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('manual');
    expect(task?.autonomousRound).toBe(20);
  });

  it('should fail if command not found', () => {
    const result = executeReportToManager(testEnv.db, {
      commandId: 'nonexistent',
      summary: 'Something',
    });

    expect(result.ok).toBe(false);
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/mcp-report-to-manager.test.ts
```

Expected: FAIL — `executeReportToManager` 不存在。

**Step 3: 实现 worker-tools.ts**

`src/lib/mcp-tools/worker-tools.ts`:

```typescript
import { tasks, commands } from '../schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const MAX_AUTONOMOUS_ROUNDS = 20;

interface ReportParams {
  commandId: string;
  summary: string;
}

interface ReportResult {
  ok: boolean;
  error?: string;
  managerCommandCreated: boolean;
}

export function executeReportToManager(db: any, params: ReportParams): ReportResult {
  const { commandId, summary } = params;

  const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
  if (!command) {
    return { ok: false, error: `Command ${commandId} not found`, managerCommandCreated: false };
  }

  // 1. Write summary to command
  db.update(commands).set({ managerSummary: summary }).where(eq(commands.id, commandId)).run();

  const task = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();
  if (!task) {
    return { ok: false, error: `Task ${command.taskId} not found`, managerCommandCreated: false };
  }

  // 2. Check task mode
  if (task.mode !== 'autonomous') {
    return { ok: true, managerCommandCreated: false };
  }

  // 3. Increment round
  const newRound = (task.autonomousRound || 0) + 1;
  db.update(tasks).set({ autonomousRound: newRound }).where(eq(tasks.id, task.id)).run();

  // 4. Check round limit
  if (newRound >= MAX_AUTONOMOUS_ROUNDS) {
    db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, task.id)).run();
    return { ok: true, managerCommandCreated: false };
  }

  // 5. Create manager review command
  const managerCommandId = uuid();
  const reviewPrompt = buildManagerReviewPrompt(command, summary);

  db.insert(commands).values({
    id: managerCommandId,
    taskId: task.id,
    prompt: reviewPrompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: task.managerProviderId,
    sessionId: task.managerSessionId,
    priority: 0,
  }).run();

  return { ok: true, managerCommandCreated: true };
}

function buildManagerReviewPrompt(command: any, summary: string): string {
  return `以下工作命令已完成，请审查结果并决定下一步。

## Worker 报告
${summary}

## 命令信息
- Prompt: ${command.prompt}
- 状态: ${command.status}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 如果命令失败：分析原因，决定重试或调整策略
6. 每次回复结束前，你必须调用一个 MCP 工具`;
}
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/mcp-report-to-manager.test.ts
```

Expected: ALL PASS (7 tests)

**Step 5: Commit**

```bash
git add src/lib/mcp-tools/worker-tools.ts src/lib/__tests__/mcp-report-to-manager.test.ts
git commit -m "feat: implement report_to_manager MCP tool for Worker role"
```

---

## Task 4: 实现 complete_task 和 pause_task 工具（Manager 专用）

**Files:**
- Modify: `src/lib/mcp-tools/manager-tools.ts`
- Create: `src/lib/__tests__/mcp-task-lifecycle.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/mcp-task-lifecycle.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects } from '../schema';
import { eq } from 'drizzle-orm';
import { executeCompleteTask, executePauseTask } from '../mcp-tools/manager-tools';

describe('complete_task (Manager tool)', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;

    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp' }).run();
    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test',
      mode: 'autonomous',
      goal: 'Build feature X',
    }).run();
  });

  afterEach(() => { testEnv.sqlite.close(); });

  it('should switch task mode to manual', () => {
    executeCompleteTask(testEnv.db, { taskId: 'task-1', summary: 'All done' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('manual');
  });

  it('should store completion summary in goal field', () => {
    executeCompleteTask(testEnv.db, { taskId: 'task-1', summary: '目标已达成，所有测试通过' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.goal).toContain('目标已达成');
  });

  it('should fail if task not found', () => {
    const result = executeCompleteTask(testEnv.db, { taskId: 'xxx', summary: 'done' });
    expect(result.ok).toBe(false);
  });
});

describe('pause_task (Manager tool)', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;

    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp' }).run();
    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test',
      mode: 'autonomous',
      goal: 'Build feature Y',
    }).run();
  });

  afterEach(() => { testEnv.sqlite.close(); });

  it('should switch task mode to manual', () => {
    executePauseTask(testEnv.db, { taskId: 'task-1', reason: '需要用户确认 API 设计' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('manual');
  });

  it('should store pause reason in goal field', () => {
    executePauseTask(testEnv.db, { taskId: 'task-1', reason: '需要选择数据库方案' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.goal).toContain('需要选择数据库方案');
  });

  it('should fail if task not found', () => {
    const result = executePauseTask(testEnv.db, { taskId: 'xxx', reason: 'wait' });
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/mcp-task-lifecycle.test.ts
```

Expected: FAIL — `executeCompleteTask` 和 `executePauseTask` 不存在。

**Step 3: 在 manager-tools.ts 中新增两个函数**

在 `src/lib/mcp-tools/manager-tools.ts` 末尾追加：

```typescript
interface CompleteTaskParams {
  taskId: string;
  summary: string;
}

type TaskResult = { ok: true } | { ok: false; error: string };

export function executeCompleteTask(db: any, params: CompleteTaskParams): TaskResult {
  const { taskId, summary } = params;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    return { ok: false, error: `Task ${taskId} not found` };
  }

  const updatedGoal = `${task.goal || ''}\n\n---\n✅ 完成摘要: ${summary}`.trim();
  db.update(tasks).set({ mode: 'manual', goal: updatedGoal }).where(eq(tasks.id, taskId)).run();
  return { ok: true };
}

interface PauseTaskParams {
  taskId: string;
  reason: string;
}

export function executePauseTask(db: any, params: PauseTaskParams): TaskResult {
  const { taskId, reason } = params;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    return { ok: false, error: `Task ${taskId} not found` };
  }

  const updatedGoal = `${task.goal || ''}\n\n---\n⏸️ 暂停原因: ${reason}`.trim();
  db.update(tasks).set({ mode: 'manual', goal: updatedGoal }).where(eq(tasks.id, taskId)).run();
  return { ok: true };
}
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/mcp-task-lifecycle.test.ts
```

Expected: ALL PASS (6 tests)

**Step 5: Commit**

```bash
git add src/lib/mcp-tools/manager-tools.ts src/lib/__tests__/mcp-task-lifecycle.test.ts
git commit -m "feat: implement complete_task and pause_task MCP tools"
```

---

## Task 5: 重构 MCP route — 角色隔离与工具注册

**Files:**
- Modify: `src/app/api/mcp/route.ts` (主要重构)
- Modify: `src/lib/mcp-tools/index.ts` (新增 registerTools)
- Create: `src/lib/mcp-tools/shared-tools.ts` (抽取共享工具)
- Create: `src/lib/__tests__/mcp-route-tools.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/mcp-route-tools.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getToolNamesForRole } from '../mcp-tools';

describe('getToolNamesForRole', () => {
  it('should return manager-specific tools for manager role', () => {
    const tools = getToolNamesForRole('manager');
    expect(tools).toContain('create_command');
    expect(tools).toContain('complete_task');
    expect(tools).toContain('pause_task');
    expect(tools).toContain('create_task');
    expect(tools).not.toContain('report_to_manager');
  });

  it('should return worker-specific tools for worker role', () => {
    const tools = getToolNamesForRole('worker');
    expect(tools).toContain('report_to_manager');
    expect(tools).not.toContain('create_command');
    expect(tools).not.toContain('complete_task');
    expect(tools).not.toContain('pause_task');
    expect(tools).not.toContain('create_task');
  });

  it('should return manual tools for manual role', () => {
    const tools = getToolNamesForRole('manual');
    expect(tools).toContain('create_task');
    expect(tools).toContain('update_command');
    expect(tools).toContain('get_task_context');
    expect(tools).toContain('list_tasks');
    expect(tools).not.toContain('create_command');
    expect(tools).not.toContain('report_to_manager');
  });

  it('should include shared tools for all roles', () => {
    for (const role of ['manager', 'worker', 'manual'] as const) {
      const tools = getToolNamesForRole(role);
      expect(tools).toContain('update_command');
      expect(tools).toContain('get_task_context');
      expect(tools).toContain('list_tasks');
    }
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/mcp-route-tools.test.ts
```

Expected: FAIL — `getToolNamesForRole` 不存在。

**Step 3: 实现角色工具映射**

更新 `src/lib/mcp-tools/index.ts`，新增：

```typescript
import type { McpRole } from './types';

const TOOL_REGISTRY: Record<McpRole, string[]> = {
  manager: ['create_command', 'complete_task', 'pause_task', 'create_task', 'update_command', 'get_task_context', 'list_tasks'],
  worker: ['report_to_manager', 'update_command', 'get_task_context', 'list_tasks'],
  manual: ['create_task', 'update_command', 'get_task_context', 'list_tasks'],
};

export function getToolNamesForRole(role: McpRole): string[] {
  return TOOL_REGISTRY[role] || TOOL_REGISTRY.manual;
}
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/mcp-route-tools.test.ts
```

Expected: ALL PASS (4 tests)

**Step 5: 重构 route.ts**

重写 `src/app/api/mcp/route.ts`，使 `createServer` 接收 `McpContext` 参数，根据角色动态注册工具。

核心改动：
1. `createServer(context: McpContext)` 替代 `createServer()`
2. POST handler 从 URL 解析 context
3. Manager 工具使用 `executeCreateCommand`/`executeCompleteTask`/`executePauseTask`
4. Worker 工具使用 `executeReportToManager`
5. 共享工具（create_task, update_command, get_task_context, list_tasks）保持原逻辑
6. Manager 工具自动注入 `context.taskId`，Worker 工具自动注入 `context.commandId`

完整的 route.ts 重写（保留原有 GET/DELETE handler）：

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { createTask } from '@/lib/tasks';
import { parseMcpContext, type McpContext } from '@/lib/mcp-tools';
import { executeCreateCommand, executeCompleteTask, executePauseTask } from '@/lib/mcp-tools/manager-tools';
import { executeReportToManager } from '@/lib/mcp-tools/worker-tools';

function createServer(context: McpContext): McpServer {
  const server = new McpServer({
    name: 'dispatch-system',
    version: '1.0.0',
  });

  // === Manager-only tools ===
  if (context.role === 'manager') {
    server.registerTool(
      'create_command',
      {
        description: 'Create a worker command to execute a task. The taskId and providerId are auto-injected.',
        inputSchema: z.object({
          prompt: z.string().describe('The work instruction for the worker'),
          mode: z.string().default('execute').describe("'execute' or 'plan'"),
        }),
      },
      async ({ prompt, mode }) => {
        const result = executeCreateCommand(db, {
          taskId: context.taskId!,
          prompt,
          mode,
        });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Worker command created: ${result.command.id}` }] };
      }
    );

    server.registerTool(
      'complete_task',
      {
        description: 'Mark the task as completed. Switches task to manual mode.',
        inputSchema: z.object({
          summary: z.string().describe('Completion summary'),
        }),
      },
      async ({ summary }) => {
        const result = executeCompleteTask(db, { taskId: context.taskId!, summary });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: 'Task marked as completed.' }] };
      }
    );

    server.registerTool(
      'pause_task',
      {
        description: 'Pause the task and wait for user confirmation. Switches to manual mode.',
        inputSchema: z.object({
          reason: z.string().describe('Why the task is paused and what user needs to decide'),
        }),
      },
      async ({ reason }) => {
        const result = executePauseTask(db, { taskId: context.taskId!, reason });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: 'Task paused, waiting for user.' }] };
      }
    );
  }

  // === Worker-only tools ===
  if (context.role === 'worker') {
    server.registerTool(
      'report_to_manager',
      {
        description: 'Report work results to the manager. Automatically triggers manager review if in autonomous mode.',
        inputSchema: z.object({
          summary: z.string().describe('Structured summary: what was done, results, issues, suggested next steps'),
        }),
      },
      async ({ summary }) => {
        const result = executeReportToManager(db, {
          commandId: context.commandId!,
          summary,
        });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        const msg = result.managerCommandCreated
          ? 'Report saved. Manager review scheduled.'
          : 'Report saved. No further action (manual mode or round limit reached).';
        return { content: [{ type: 'text' as const, text: msg }] };
      }
    );
  }

  // === Shared tools (all roles) ===

  // create_task — manual and manager only
  if (context.role === 'manual' || context.role === 'manager') {
    server.registerTool(
      'create_task',
      {
        description: 'Create a new task under a project with an isolated git worktree.',
        inputSchema: z.object({
          projectId: z.string().describe('The project ID to create the task under'),
          description: z.string().describe('Name/description of the task'),
          branch: z.string().optional().describe('Git branch name (lowercase, digits, hyphens only). Auto-generated if omitted.'),
          baseBranch: z.string().optional().describe('Base branch to create from (start-point). Defaults to "main" if omitted.'),
        }),
      },
      async ({ projectId, description, branch, baseBranch }) => {
        const result = createTask({ projectId, description, branch, baseBranch });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(result.task, null, 2) }] };
      }
    );
  }

  server.registerTool(
    'update_command',
    {
      description: 'Update the status of a command. Use to report progress or mark completion.',
      inputSchema: z.object({
        commandId: z.string().describe('The command ID to update'),
        status: z.string().describe('New status: queued, running, completed, failed, aborted'),
        result: z.string().optional().describe('Optional result text'),
      }),
    },
    async ({ commandId, status, result }) => {
      try {
        const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
        if (!command) {
          return { content: [{ type: 'text' as const, text: `Error: Command ${commandId} not found` }], isError: true };
        }
        db.update(commands).set({
          status,
          ...(result ? { result } : {}),
        }).where(eq(commands.id, commandId)).run();
        const updated = db.select().from(commands).where(eq(commands.id, commandId)).get();
        return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'get_task_context',
    {
      description: 'Get full context for a task including its commands history.',
      inputSchema: z.object({
        taskId: z.string().describe('The task ID to get context for'),
      }),
    },
    async ({ taskId }) => {
      try {
        const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
        if (!task) {
          return { content: [{ type: 'text' as const, text: `Error: Task ${taskId} not found` }], isError: true };
        }
        const taskCommands = db.select().from(commands).where(eq(commands.taskId, taskId)).all();
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ...task, commands: taskCommands }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    'list_tasks',
    {
      description: 'List all tasks for a project to see related work and progress.',
      inputSchema: z.object({
        projectId: z.string().describe('The project ID to list tasks for'),
      }),
    },
    async ({ projectId }) => {
      try {
        const taskList = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
        return { content: [{ type: 'text' as const, text: JSON.stringify(taskList, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const context = parseMcpContext(url.searchParams);
  const server = createServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  return transport.handleRequest(request);
}

export async function DELETE(request: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  return transport.handleRequest(request);
}
```

**Step 6: 运行全部测试验证**

```bash
pnpm test
```

Expected: ALL PASS (全部通过，含新增的 context + tools 测试)

**Step 7: 运行 build 确认编译通过**

```bash
pnpm build
```

**Step 8: Commit**

```bash
git add src/app/api/mcp/route.ts src/lib/mcp-tools/ src/lib/__tests__/mcp-route-tools.test.ts
git commit -m "feat: refactor MCP route with role isolation and context injection"
```

---

## Task 6: 修改 claude-runner.ts 注入角色上下文到 MCP URL

**Files:**
- Modify: `src/lib/claude-runner.ts`
- Modify: `mcp-config.json` (不再需要修改，运行时动态生成)
- Create: `src/lib/__tests__/mcp-url-builder.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/mcp-url-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildMcpUrl } from '../mcp-tools';

describe('buildMcpUrl', () => {
  const baseUrl = 'http://localhost:3000/api/mcp';

  it('should build manager MCP URL with context', () => {
    const url = buildMcpUrl(baseUrl, { role: 'manager', commandId: 'cmd-1', taskId: 'task-1' });
    expect(url).toBe('http://localhost:3000/api/mcp?role=manager&commandId=cmd-1&taskId=task-1');
  });

  it('should build worker MCP URL with context', () => {
    const url = buildMcpUrl(baseUrl, { role: 'worker', commandId: 'cmd-2', taskId: 'task-2' });
    expect(url).toBe('http://localhost:3000/api/mcp?role=worker&commandId=cmd-2&taskId=task-2');
  });

  it('should build manual MCP URL without context', () => {
    const url = buildMcpUrl(baseUrl, { role: 'manual' });
    expect(url).toBe('http://localhost:3000/api/mcp');
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/mcp-url-builder.test.ts
```

**Step 3: 在 mcp-tools/index.ts 中添加 buildMcpUrl**

```typescript
export function buildMcpUrl(baseUrl: string, context: McpContext): string {
  if (context.role === 'manual') return baseUrl;
  const params = new URLSearchParams();
  params.set('role', context.role);
  if (context.commandId) params.set('commandId', context.commandId);
  if (context.taskId) params.set('taskId', context.taskId);
  return `${baseUrl}?${params.toString()}`;
}
```

**Step 4: 运行测试验证通过**

**Step 5: 修改 claude-runner.ts**

在 `runCommand` 函数中，替换现有的 MCP config 注入逻辑。改为：根据 command.role 和 task 信息动态生成 mcp-config JSON（带角色上下文的 URL），写入临时文件。

核心变更点（在 `const mcpConfigPath = ...` 附近）：

```typescript
import { buildMcpUrl } from './mcp-tools';
import { writeFileSync } from 'fs';

// 替换原有 MCP config 逻辑
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const mcpBaseUrl = `${API_BASE}/api/mcp`;
const mcpContext = {
  role: (command.role || 'worker') as 'manager' | 'worker' | 'manual',
  commandId: command.id,
  taskId: command.taskId,
};
const mcpUrl = buildMcpUrl(mcpBaseUrl, mcpContext);

// Write temporary MCP config with contextualized URL
const tmpMcpConfig = join(LOG_DIR, `mcp-${commandId}.json`);
writeFileSync(tmpMcpConfig, JSON.stringify({
  mcpServers: {
    dispatch: { type: 'http', url: mcpUrl }
  }
}, null, 2));
args.push('--mcp-config', tmpMcpConfig);
```

同时在命令完成后（`child.on('close')`）清理临时 MCP config 文件。

**Manager 命令的 session resume 逻辑变更：**

对于 manager 角色的命令，使用 `task.managerSessionId` 进行 session resume（而非查找前序命令）。同时，在 manager 命令首次获取到 sessionId 后，回写 `task.managerSessionId`。

**Step 6: 运行全部测试 + build 验证**

```bash
pnpm test && pnpm build
```

**Step 7: Commit**

```bash
git add src/lib/claude-runner.ts src/lib/mcp-tools/index.ts src/lib/__tests__/mcp-url-builder.test.ts
git commit -m "feat: inject role context into MCP URL for Claude CLI processes"
```

---

## Phase 2 完成标准

- [ ] MCP 上下文解析（parseMcpContext）+ 4 tests
- [ ] create_command 工具 + 5 tests
- [ ] report_to_manager 工具 + 7 tests
- [ ] complete_task + pause_task 工具 + 6 tests
- [ ] MCP route 角色隔离重构 + 4 tests
- [ ] claude-runner MCP URL 注入 + 3 tests
- [ ] 全量测试通过
- [ ] pnpm build 成功
- [ ] 所有变更已 commit
