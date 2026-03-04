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
    const managerCmd = allCmds.find((c: any) => c.role === 'manager');
    expect(managerCmd).toBeDefined();
    expect(managerCmd?.status).toBe('queued');
    expect(managerCmd?.providerId).toBe('prov-mgr');
    expect(managerCmd?.mode).toBe('plan');
  });

  it('should set sessionId on manager command for session resume', () => {
    executeReportToManager(testEnv.db, {
      commandId: 'cmd-worker-1',
      summary: 'Done',
    });

    const allCmds = testEnv.db.select().from(commands).all();
    const managerCmd = allCmds.find((c: any) => c.role === 'manager');
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
