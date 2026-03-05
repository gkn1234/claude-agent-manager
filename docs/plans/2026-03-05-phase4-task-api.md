# Phase 4: 任务 API 模式切换 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增任务模式切换 API 端点：启动自主模式、暂停自主模式、恢复自主模式。

**Architecture:** 在现有 `PATCH /api/tasks/[id]` 中扩展，通过 `action` 字段分发不同操作。新增 `src/lib/autonomous.ts` 共享函数，被 API 和未来的 MCP 工具共同调用。

**Tech Stack:** Next.js API Routes, Drizzle ORM + SQLite, Zod, Vitest

**Design Doc:** `docs/plans/2026-03-05-autonomous-task-manager-design.md` → "用户介入机制" 章节

---

## Task 1: TDD — 自主模式操作共享函数

**Files:**
- Create: `src/lib/autonomous.ts`
- Create: `src/lib/__tests__/autonomous.test.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/autonomous.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands, providers } from '../schema';
import { eq } from 'drizzle-orm';
import { startAutonomous, pauseAutonomous, resumeAutonomous } from '../autonomous';

describe('startAutonomous', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;
    db.insert(providers).values({ id: 'prov-mgr', name: 'Manager', envJson: '{}' }).run();
    db.insert(providers).values({ id: 'prov-wkr', name: 'Worker', envJson: '{}' }).run();
    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp' }).run();
    db.insert(tasks).values({
      id: 'task-1', projectId: 'proj-1', description: 'Test', branch: 'test', mode: 'manual',
    }).run();
  });

  afterEach(() => { testEnv.sqlite.close(); });

  it('should switch task to autonomous mode', () => {
    const result = startAutonomous(testEnv.db, {
      taskId: 'task-1',
      goal: 'Build auth module',
      managerProviderId: 'prov-mgr',
      workerProviderId: 'prov-wkr',
    });
    expect(result.ok).toBe(true);
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('autonomous');
    expect(task?.goal).toBe('Build auth module');
    expect(task?.managerProviderId).toBe('prov-mgr');
    expect(task?.workerProviderId).toBe('prov-wkr');
    expect(task?.autonomousRound).toBe(0);
  });

  it('should create initial manager command', () => {
    const result = startAutonomous(testEnv.db, {
      taskId: 'task-1',
      goal: 'Build auth',
      managerProviderId: 'prov-mgr',
      workerProviderId: 'prov-wkr',
    });
    expect(result.ok).toBe(true);
    const cmds = testEnv.db.select().from(commands).all();
    const mgrCmd = cmds.find((c: any) => c.role === 'manager');
    expect(mgrCmd).toBeDefined();
    expect(mgrCmd?.status).toBe('queued');
    expect(mgrCmd?.mode).toBe('plan');
    expect(mgrCmd?.providerId).toBe('prov-mgr');
    expect(mgrCmd?.prompt).toContain('Build auth');
  });

  it('should fail if task not found', () => {
    const result = startAutonomous(testEnv.db, {
      taskId: 'xxx', goal: 'test', managerProviderId: 'prov-mgr', workerProviderId: 'prov-wkr',
    });
    expect(result.ok).toBe(false);
  });

  it('should fail if task is already autonomous', () => {
    testEnv.db.update(tasks).set({ mode: 'autonomous' }).where(eq(tasks.id, 'task-1')).run();
    const result = startAutonomous(testEnv.db, {
      taskId: 'task-1', goal: 'test', managerProviderId: 'prov-mgr', workerProviderId: 'prov-wkr',
    });
    expect(result.ok).toBe(false);
  });
});

describe('pauseAutonomous', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;
    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp' }).run();
    db.insert(tasks).values({
      id: 'task-1', projectId: 'proj-1', description: 'Test', branch: 'test',
      mode: 'autonomous', goal: 'Build something',
      managerProviderId: 'prov-mgr', workerProviderId: 'prov-wkr',
    }).run();
  });

  afterEach(() => { testEnv.sqlite.close(); });

  it('should switch task to manual mode', () => {
    pauseAutonomous(testEnv.db, { taskId: 'task-1' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('manual');
  });

  it('should preserve provider settings', () => {
    pauseAutonomous(testEnv.db, { taskId: 'task-1' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.managerProviderId).toBe('prov-mgr');
    expect(task?.workerProviderId).toBe('prov-wkr');
  });
});

describe('resumeAutonomous', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;
    db.insert(providers).values({ id: 'prov-mgr', name: 'Manager', envJson: '{}' }).run();
    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp' }).run();
    db.insert(tasks).values({
      id: 'task-1', projectId: 'proj-1', description: 'Test', branch: 'test',
      mode: 'manual', goal: 'Build something',
      managerSessionId: 'session-old',
      managerProviderId: 'prov-mgr', workerProviderId: 'prov-wkr',
      autonomousRound: 5,
    }).run();
  });

  afterEach(() => { testEnv.sqlite.close(); });

  it('should switch task back to autonomous mode', () => {
    resumeAutonomous(testEnv.db, { taskId: 'task-1' });
    const task = testEnv.db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('autonomous');
  });

  it('should create resume manager command with session resume', () => {
    // Add a completed command so there's something to review
    testEnv.db.insert(commands).values({
      id: 'cmd-last', taskId: 'task-1', prompt: 'Last work', role: 'worker',
      status: 'completed', result: 'Did some work',
    }).run();

    resumeAutonomous(testEnv.db, { taskId: 'task-1' });
    const cmds = testEnv.db.select().from(commands).all();
    const mgrCmd = cmds.find((c: any) => c.role === 'manager');
    expect(mgrCmd).toBeDefined();
    expect(mgrCmd?.status).toBe('queued');
    expect(mgrCmd?.sessionId).toBe('session-old');
    expect(mgrCmd?.providerId).toBe('prov-mgr');
  });

  it('should fail if task has no managerProviderId', () => {
    testEnv.db.update(tasks).set({ managerProviderId: null }).where(eq(tasks.id, 'task-1')).run();
    const result = resumeAutonomous(testEnv.db, { taskId: 'task-1' });
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Run test, verify FAIL**

```bash
pnpm test src/lib/__tests__/autonomous.test.ts
```

**Step 3: Implement `src/lib/autonomous.ts`**

```typescript
import { tasks, commands } from './schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

type Result = { ok: true } | { ok: false; error: string };

interface StartParams {
  taskId: string;
  goal: string;
  managerProviderId: string;
  workerProviderId: string;
}

export function startAutonomous(db: any, params: StartParams): Result {
  const { taskId, goal, managerProviderId, workerProviderId } = params;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };
  if (task.mode === 'autonomous') return { ok: false, error: 'Task is already in autonomous mode' };

  // Update task
  db.update(tasks).set({
    mode: 'autonomous',
    goal,
    managerProviderId,
    workerProviderId,
    autonomousRound: 0,
    managerSessionId: null,
  }).where(eq(tasks.id, taskId)).run();

  // Create initial manager command with goal prompt
  const commandId = uuid();
  const prompt = buildInitialManagerPrompt(task, goal);

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: managerProviderId,
    priority: 0,
  }).run();

  return { ok: true };
}

interface PauseParams {
  taskId: string;
}

export function pauseAutonomous(db: any, params: PauseParams): Result {
  const { taskId } = params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };

  db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, taskId)).run();
  return { ok: true };
}

interface ResumeParams {
  taskId: string;
}

export function resumeAutonomous(db: any, params: ResumeParams): Result {
  const { taskId } = params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };
  if (!task.managerProviderId) return { ok: false, error: 'Task has no managerProviderId' };

  db.update(tasks).set({ mode: 'autonomous' }).where(eq(tasks.id, taskId)).run();

  // Get latest command result for context
  const lastCmd = db.select().from(commands)
    .where(eq(commands.taskId, taskId))
    .orderBy(desc(commands.createdAt))
    .limit(1)
    .get();

  const lastSummary = lastCmd?.managerSummary || lastCmd?.result || '(no previous results)';

  const commandId = uuid();
  const prompt = `自主模式已恢复。请审查当前进度并决定下一步。

## 任务目标
${task.goal || '(no goal set)'}

## 最近命令结果
${(lastSummary as string).slice(0, 4000)}

## 你的行动
1. 审查当前进度
2. 如果需要继续：通过 create_command 派发工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task
5. 每次回复结束前，你必须调用一个 MCP 工具`;

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: task.managerProviderId,
    sessionId: task.managerSessionId || null,
    priority: 0,
  }).run();

  return { ok: true };
}

function buildInitialManagerPrompt(task: any, goal: string): string {
  return `你是 Claude Dispatch 任务管理器（Manager）。你的职责是自主推进目标的完成。

## 任务目标
${goal}

## 当前工作环境
- 任务: ${task.description}
- 工作目录: ${task.worktreeDir || '(pending)'}
- 分支: ${task.branch}

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
- Worker 完成后你会收到其报告，届时再审查并决定下一步`;
}
```

**Step 4: Run test, verify PASS**

```bash
pnpm test src/lib/__tests__/autonomous.test.ts
```

Expected: ALL PASS (9 tests)

**Step 5: Commit**

```bash
git add src/lib/autonomous.ts src/lib/__tests__/autonomous.test.ts
git commit -m "feat: implement autonomous mode operations (start/pause/resume)"
```

---

## Task 2: 扩展 PATCH /api/tasks/[id] 端点

**Files:**
- Modify: `src/app/api/tasks/[id]/route.ts`

**Step 1: 修改 PATCH handler**

Read the current file first. Then update the PATCH handler to support `action` field for autonomous mode operations.

The current PATCH handler handles `lastProviderId` and `lastMode` updates. Add action handling:

```typescript
import { startAutonomous, pauseAutonomous, resumeAutonomous } from '@/lib/autonomous';

// In the PATCH handler, after the existing body parsing:
if (body.action === 'start_autonomous') {
  const result = startAutonomous(db, {
    taskId: id,
    goal: body.goal,
    managerProviderId: body.managerProviderId,
    workerProviderId: body.workerProviderId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

if (body.action === 'pause_autonomous') {
  const result = pauseAutonomous(db, { taskId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

if (body.action === 'resume_autonomous') {
  const result = resumeAutonomous(db, { taskId: id });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

This should be placed BEFORE the existing updates block (the `if (body.lastProviderId !== undefined)` section), so that action-based requests are handled first and return early.

**Step 2: Run all tests + build**

```bash
pnpm test && pnpm build
```

Expected: ALL PASS + build success

**Step 3: Commit**

```bash
git add src/app/api/tasks/[id]/route.ts
git commit -m "feat: add autonomous mode actions to task PATCH endpoint"
```

---

## Phase 4 完成标准

- [ ] startAutonomous/pauseAutonomous/resumeAutonomous 共享函数 + 9 tests
- [ ] PATCH /api/tasks/[id] 支持 start_autonomous/pause_autonomous/resume_autonomous actions
- [ ] 全量测试通过
- [ ] pnpm build 成功
