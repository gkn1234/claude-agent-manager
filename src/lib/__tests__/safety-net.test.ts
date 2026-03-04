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
      id: 'cmd-done', taskId: 'task-1', prompt: 'Done', role: 'worker', status: 'completed',
    }).run();
    testEnv.db.insert(commands).values({
      id: 'cmd-next', taskId: 'task-1', prompt: 'Review', role: 'manager', status: 'queued',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(false);
  });

  it('should NOT create fallback when running commands exist', () => {
    testEnv.db.insert(commands).values({
      id: 'cmd-done', taskId: 'task-1', prompt: 'Done', role: 'worker', status: 'completed',
    }).run();
    testEnv.db.insert(commands).values({
      id: 'cmd-running', taskId: 'task-1', prompt: 'Still running', role: 'worker', status: 'running',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(false);
  });

  it('should NOT create fallback when task is in manual mode', () => {
    testEnv.db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, 'task-1')).run();
    testEnv.db.insert(commands).values({
      id: 'cmd-done', taskId: 'task-1', prompt: 'Done', role: 'worker', status: 'completed',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');
    expect(created).toBe(false);
  });

  it('should truncate long results to 4000 chars in fallback prompt', () => {
    const longResult = 'A'.repeat(5000);
    testEnv.db.insert(commands).values({
      id: 'cmd-done', taskId: 'task-1', prompt: 'Do work', role: 'worker', status: 'failed', result: longResult,
    }).run();

    checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-done');

    const allCmds = testEnv.db.select().from(commands).all();
    const fallback = allCmds.find((c: any) => c.role === 'manager' && c.id !== 'cmd-done');
    expect(fallback?.prompt.length).toBeLessThan(5000);
  });

  it('should handle aborted commands', () => {
    testEnv.db.insert(commands).values({
      id: 'cmd-aborted', taskId: 'task-1', prompt: 'Do work', role: 'worker', status: 'aborted',
      result: 'Command was aborted due to timeout',
    }).run();

    const created = checkAndRecoverAutonomousTask(testEnv.db, 'task-1', 'cmd-aborted');
    expect(created).toBe(true);

    const allCmds = testEnv.db.select().from(commands).all();
    const fallback = allCmds.find((c: any) => c.role === 'manager' && c.id !== 'cmd-aborted');
    expect(fallback?.prompt).toContain('aborted');
  });
});
