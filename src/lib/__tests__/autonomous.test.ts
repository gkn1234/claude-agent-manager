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
    startAutonomous(testEnv.db, {
      taskId: 'task-1', goal: 'Build auth',
      managerProviderId: 'prov-mgr', workerProviderId: 'prov-wkr',
    });
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
