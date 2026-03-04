import { tasks, commands } from './schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { buildInitialManagerPrompt, buildResumeManagerPrompt } from './prompts';

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

  db.update(tasks).set({
    mode: 'autonomous',
    goal,
    managerProviderId,
    workerProviderId,
    autonomousRound: 0,
    managerSessionId: null,
  }).where(eq(tasks.id, taskId)).run();

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

interface PauseParams { taskId: string; }

export function pauseAutonomous(db: any, params: PauseParams): Result {
  const { taskId } = params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };

  db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, taskId)).run();
  return { ok: true };
}

interface ResumeParams { taskId: string; }

export function resumeAutonomous(db: any, params: ResumeParams): Result {
  const { taskId } = params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };
  if (!task.managerProviderId) return { ok: false, error: 'Task has no managerProviderId' };

  db.update(tasks).set({ mode: 'autonomous' }).where(eq(tasks.id, taskId)).run();

  const lastCmd = db.select().from(commands)
    .where(eq(commands.taskId, taskId))
    .orderBy(desc(commands.createdAt))
    .limit(1)
    .get();

  const lastSummary = lastCmd?.managerSummary || lastCmd?.result || '(no previous results)';

  const commandId = uuid();
  const prompt = buildResumeManagerPrompt(task.goal, lastSummary as string);

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
