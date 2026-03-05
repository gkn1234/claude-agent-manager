# Phase 3: 调度器安全网 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在命令完成/失败/中止回调中新增循环中断检测，防止 Worker/Manager 崩溃导致自主循环静默停滞。

**Architecture:** 在 `claude-runner.ts` 的 `child.on('close')` 回调末尾，对 autonomous 模式的任务延迟检查是否有后续命令。如果没有（说明 MCP 工具未被调用），创建 fallback manager 命令恢复循环。

**Tech Stack:** Node.js setTimeout, Drizzle ORM, Vitest

**Design Doc:** `docs/plans/2026-03-05-autonomous-task-manager-design.md` → "调度器变更" 章节

---

## Task 1: TDD — 安全网检测逻辑

**Files:**
- Create: `src/lib/__tests__/safety-net.test.ts`
- Create: `src/lib/safety-net.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/safety-net.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands, providers } from '../schema';
import { eq } from 'drizzle-orm';
import { checkAndRecoverAutonomousTask } from '../safety-net';

describe('safety net - checkAndRecoverAutonomousTask', () => {
  let testEnv: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    testEnv = createTestDb();
    const { db } = testEnv;

    db.insert(providers).values({ id: 'prov-mgr', name: 'Manager', envJson: '{}' }).run();
    db.insert(projects).values({ id: 'proj-1', name: 'Test', workDir: '/tmp' }).run();

    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Autonomous task',
      branch: 'auto-branch',
      mode: 'autonomous',
      managerSessionId: 'session-mgr',
      managerProviderId: 'prov-mgr',
      workerProviderId: 'prov-mgr',
      autonomousRound: 3,
    }).run();
  });

  afterEach(() => { testEnv.sqlite.close(); });

  it('should create fallback manager command when no queued/running commands exist', () => {
    // Worker command that just finished — no follow-up created by MCP
    testEnv.db.insert(commands).values({
      id: 'cmd-done',
      taskId: 'task-1',
      prompt: 'Do work',
      role: 'worker',
      status: 'completed',
      result: 'Task completed successfully',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(true);

    const allCmds = testEnv.db.select().from(commands).all();
    const fallback = allCmds.find((c: any) => c.role === 'manager' && c.id !== 'cmd-done');
    expect(fallback).toBeDefined();
    expect(fallback?.status).toBe('queued');
    expect(fallback?.role).toBe('manager');
    expect(fallback?.mode).toBe('plan');
    expect(fallback?.providerId).toBe('prov-mgr');
    expect(fallback?.sessionId).toBe('session-mgr');
    expect(fallback?.prompt).toContain('Task completed successfully');
  });

  it('should NOT create fallback when queued commands already exist', () => {
    testEnv.db.insert(commands).values({
      id: 'cmd-done',
      taskId: 'task-1',
      prompt: 'Done work',
      role: 'worker',
      status: 'completed',
    }).run();

    // Already has a queued follow-up (normal flow)
    testEnv.db.insert(commands).values({
      id: 'cmd-next',
      taskId: 'task-1',
      prompt: 'Review',
      role: 'manager',
      status: 'queued',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(false);
  });

  it('should NOT create fallback when running commands exist', () => {
    testEnv.db.insert(commands).values({
      id: 'cmd-done',
      taskId: 'task-1',
      prompt: 'Done',
      role: 'worker',
      status: 'completed',
    }).run();

    testEnv.db.insert(commands).values({
      id: 'cmd-running',
      taskId: 'task-1',
      prompt: 'Still running',
      role: 'worker',
      status: 'running',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(false);
  });

  it('should NOT create fallback when task is in manual mode', () => {
    testEnv.db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, 'task-1')).run();

    testEnv.db.insert(commands).values({
      id: 'cmd-done',
      taskId: 'task-1',
      prompt: 'Done',
      role: 'worker',
      status: 'completed',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(false);
  });

  it('should truncate long results to 4000 chars in fallback prompt', () => {
    const longResult = 'A'.repeat(5000);
    testEnv.db.insert(commands).values({
      id: 'cmd-done',
      taskId: 'task-1',
      prompt: 'Do work',
      role: 'worker',
      status: 'failed',
      result: longResult,
    }).run();

    checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');

    const allCmds = testEnv.db.select().from(commands).all();
    const fallback = allCmds.find((c: any) => c.role === 'manager' && c.id !== 'cmd-done');
    expect(fallback?.prompt.length).toBeLessThan(5000);
  });

  it('should handle aborted commands', () => {
    testEnv.db.insert(commands).values({
      id: 'cmd-aborted',
      taskId: 'task-1',
      prompt: 'Do work',
      role: 'worker',
      status: 'aborted',
      result: 'Command was aborted due to timeout',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-aborted');
    expect(created).toBe(true);

    const allCmds = testEnv.db.select().from(commands).all();
    const fallback = allCmds.find((c: any) => c.role === 'manager' && c.id !== 'cmd-aborted');
    expect(fallback?.prompt).toContain('aborted');
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/safety-net.test.ts
```

Expected: FAIL — `checkAndRecoverAutonomousTask` 不存在。

**Step 3: 实现 safety-net.ts**

`src/lib/safety-net.ts`:

```typescript
import { tasks, commands } from './schema';
import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const MAX_RESULT_LENGTH = 4000;

/**
 * Safety net: check if an autonomous task has stalled (no queued/running commands).
 * If so, create a fallback manager command to recover the loop.
 * Returns true if a fallback command was created.
 */
export function checkAndRecoverAutonomousTask(
  db: any,
  taskId: string,
  finishedCommandId: string,
): boolean {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task || task.mode !== 'autonomous') return false;

  // Check if there are any queued or running commands for this task
  const activeCommands = db.select()
    .from(commands)
    .where(
      and(
        eq(commands.taskId, taskId),
        inArray(commands.status, ['queued', 'running']),
      )
    )
    .all();

  if (activeCommands.length > 0) return false;

  // No active commands — task has stalled, create fallback manager command
  const finishedCommand = db.select().from(commands).where(eq(commands.id, finishedCommandId)).get();
  const resultText = finishedCommand?.result
    ? finishedCommand.result.slice(0, MAX_RESULT_LENGTH)
    : '(no result available)';

  const fallbackPrompt = `以下工作命令已完成，但未通过 MCP 工具触发后续流程。请审查结果并决定下一步。

## 命令信息
- Prompt: ${finishedCommand?.prompt || '(unknown)'}
- 状态: ${finishedCommand?.status || '(unknown)'}
- 角色: ${finishedCommand?.role || '(unknown)'}

## 命令结果（截取前 ${MAX_RESULT_LENGTH} 字符）
${resultText}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 每次回复结束前，你必须调用一个 MCP 工具`;

  const managerCommandId = uuid();
  db.insert(commands).values({
    id: managerCommandId,
    taskId,
    prompt: fallbackPrompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: task.managerProviderId,
    sessionId: task.managerSessionId,
    priority: 0,
  }).run();

  console.log(`[SafetyNet] Created fallback manager command ${managerCommandId} for task ${taskId}`);
  return true;
}
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/safety-net.test.ts
```

Expected: ALL PASS (6 tests)

**Step 5: Commit**

```bash
git add src/lib/safety-net.ts src/lib/__tests__/safety-net.test.ts
git commit -m "feat: implement safety net for autonomous task loop recovery"
```

---

## Task 2: 集成安全网到 claude-runner.ts

**Files:**
- Modify: `src/lib/claude-runner.ts`

**Step 1: 在 claude-runner.ts 中导入安全网**

在导入区域添加：
```typescript
import { checkAndRecoverAutonomousTask } from './safety-net';
import { getConfig } from '@/lib/config';
```

注意：`getConfig` 可能已经导入了，检查一下。

**Step 2: 在 child.on('close') 回调末尾添加安全网触发**

在 `child.on('close', (code) => { ... })` 的最末尾（在 `db.update(commands).set(...)` 之后），添加：

```typescript
    // Safety net: delayed check for autonomous task stall
    const finishedTask = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();
    if (finishedTask?.mode === 'autonomous') {
      const delay = parseInt(getConfig('safety_net_delay_ms', '3000'));
      setTimeout(() => {
        checkAndRecoverAutonomousTask(db, command.taskId, commandId);
      }, delay);
    }
```

**Step 3: 运行全部测试 + build**

```bash
pnpm test && pnpm build
```

**Step 4: Commit**

```bash
git add src/lib/claude-runner.ts
git commit -m "feat: integrate safety net into claude-runner command completion"
```

---

## Phase 3 完成标准

- [ ] checkAndRecoverAutonomousTask 函数 + 6 tests
- [ ] claude-runner 集成安全网触发
- [ ] 全量测试通过
- [ ] pnpm build 成功
