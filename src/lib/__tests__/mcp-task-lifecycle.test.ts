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
