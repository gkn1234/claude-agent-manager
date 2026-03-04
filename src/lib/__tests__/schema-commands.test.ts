import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands } from '../schema';
import { eq } from 'drizzle-orm';

describe('commands schema - role and managerSummary fields', () => {
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

    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test-branch',
    }).run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should have role field defaulting to "worker"', () => {
    db.insert(commands).values({
      id: 'cmd-1',
      taskId: 'task-1',
      prompt: 'Do something',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-1')).get();
    expect(cmd?.role).toBe('worker');
  });

  it('should allow setting role to "manager"', () => {
    db.insert(commands).values({
      id: 'cmd-2',
      taskId: 'task-1',
      prompt: 'Review worker output',
      role: 'manager',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-2')).get();
    expect(cmd?.role).toBe('manager');
  });

  it('should store managerSummary', () => {
    const summary = '已完成认证模块，所有测试通过，建议下一步实现授权中间件';
    db.insert(commands).values({
      id: 'cmd-3',
      taskId: 'task-1',
      prompt: 'Implement auth',
      managerSummary: summary,
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-3')).get();
    expect(cmd?.managerSummary).toBe(summary);
  });

  it('should have managerSummary as null by default', () => {
    db.insert(commands).values({
      id: 'cmd-4',
      taskId: 'task-1',
      prompt: 'Regular command',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-4')).get();
    expect(cmd?.managerSummary).toBeNull();
  });

  it('should support manager command with full fields', () => {
    db.insert(commands).values({
      id: 'cmd-full',
      taskId: 'task-1',
      prompt: 'Review and decide next step',
      mode: 'plan',
      status: 'queued',
      role: 'manager',
      managerSummary: '工作完成，质量合格',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-full')).get();
    expect(cmd).toMatchObject({
      id: 'cmd-full',
      role: 'manager',
      mode: 'plan',
      status: 'queued',
      managerSummary: '工作完成，质量合格',
    });
  });
});
