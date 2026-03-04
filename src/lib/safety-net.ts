import { tasks, commands } from './schema';
import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { buildSafetyNetFallbackPrompt } from './prompts';

export function checkAndRecoverAutonomousTask(
  db: any,
  taskId: string,
  finishedCommandId: string,
): boolean {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task || task.mode !== 'autonomous') return false;

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

  const finishedCommand = db.select().from(commands).where(eq(commands.id, finishedCommandId)).get();
  const fallbackPrompt = buildSafetyNetFallbackPrompt({
    prompt: finishedCommand?.prompt || null,
    status: finishedCommand?.status || null,
    role: finishedCommand?.role || null,
    result: finishedCommand?.result || null,
  });

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
