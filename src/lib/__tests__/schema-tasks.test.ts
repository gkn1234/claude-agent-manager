import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects } from '../schema';
import { eq } from 'drizzle-orm';

describe('tasks schema - autonomous fields', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  beforeEach(() => {
    const testEnv = createTestDb();
    db = testEnv.db;
    sqlite = testEnv.sqlite;

    db.insert(projects).values({
      id: 'proj-1',
      name: 'Test Project',
      workDir: '/tmp/test',
    }).run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should have mode field defaulting to "manual"', () => {
    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test-branch',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('manual');
  });

  it('should allow setting mode to "autonomous"', () => {
    db.insert(tasks).values({
      id: 'task-2',
      projectId: 'proj-1',
      description: 'Autonomous task',
      branch: 'auto-branch',
      mode: 'autonomous',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-2')).get();
    expect(task?.mode).toBe('autonomous');
  });

  it('should store goal text', () => {
    const goal = '实现用户认证模块，包含登录、注册、JWT 验证';
    db.insert(tasks).values({
      id: 'task-3',
      projectId: 'proj-1',
      description: 'Auth task',
      branch: 'auth-branch',
      goal,
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-3')).get();
    expect(task?.goal).toBe(goal);
  });

  it('should have goal as null by default', () => {
    db.insert(tasks).values({
      id: 'task-4',
      projectId: 'proj-1',
      description: 'No goal task',
      branch: 'no-goal',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-4')).get();
    expect(task?.goal).toBeNull();
  });

  it('should store managerSessionId', () => {
    db.insert(tasks).values({
      id: 'task-5',
      projectId: 'proj-1',
      description: 'Manager task',
      branch: 'mgr-branch',
      managerSessionId: 'session-abc-123',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-5')).get();
    expect(task?.managerSessionId).toBe('session-abc-123');
  });

  it('should store managerProviderId and workerProviderId', () => {
    db.insert(tasks).values({
      id: 'task-6',
      projectId: 'proj-1',
      description: 'Provider task',
      branch: 'prov-branch',
      managerProviderId: 'provider-mgr',
      workerProviderId: 'provider-wkr',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-6')).get();
    expect(task?.managerProviderId).toBe('provider-mgr');
    expect(task?.workerProviderId).toBe('provider-wkr');
  });

  it('should have autonomousRound defaulting to 0', () => {
    db.insert(tasks).values({
      id: 'task-7',
      projectId: 'proj-1',
      description: 'Round task',
      branch: 'round-branch',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-7')).get();
    expect(task?.autonomousRound).toBe(0);
  });

  it('should allow incrementing autonomousRound', () => {
    db.insert(tasks).values({
      id: 'task-8',
      projectId: 'proj-1',
      description: 'Increment task',
      branch: 'inc-branch',
      autonomousRound: 5,
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-8')).get();
    expect(task?.autonomousRound).toBe(5);
  });

  it('should support full autonomous task creation with all new fields', () => {
    db.insert(tasks).values({
      id: 'task-full',
      projectId: 'proj-1',
      description: 'Full autonomous task',
      branch: 'full-branch',
      mode: 'autonomous',
      goal: '完成所有自主模式字段的测试',
      managerSessionId: 'session-full',
      managerProviderId: 'mgr-prov',
      workerProviderId: 'wkr-prov',
      autonomousRound: 3,
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-full')).get();
    expect(task).toMatchObject({
      id: 'task-full',
      mode: 'autonomous',
      goal: '完成所有自主模式字段的测试',
      managerSessionId: 'session-full',
      managerProviderId: 'mgr-prov',
      workerProviderId: 'wkr-prov',
      autonomousRound: 3,
    });
  });
});
