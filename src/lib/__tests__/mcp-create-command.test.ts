import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands, providers } from '../schema';
import { eq } from 'drizzle-orm';
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
