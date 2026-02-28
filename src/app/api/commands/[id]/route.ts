import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands, tasks } from '@/lib/schema';
import { eq, and, inArray, not, desc } from 'drizzle-orm';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['queued'],
  queued: ['running', 'pending'],
  running: ['completed', 'failed', 'aborted'],
  // completed, failed, aborted are terminal states - no transitions allowed
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!command) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Fetch task context for the command input area
  const task = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();

  let isLatestFinished = false;
  let hasRunning = false;

  if (task) {
    // Check if there's a running command for this task
    const runningCmd = db.select({ id: commands.id })
      .from(commands)
      .where(and(
        eq(commands.taskId, command.taskId),
        inArray(commands.status, ['running', 'queued']),
      ))
      .limit(1)
      .get();
    hasRunning = !!runningCmd;

    // Check if this command is the latest finished non-init command
    const terminalStatuses = ['completed', 'failed', 'aborted'];
    if (command.status && terminalStatuses.includes(command.status) && command.mode !== 'init') {
      const latest = db.select({ id: commands.id })
        .from(commands)
        .where(and(
          eq(commands.taskId, command.taskId),
          inArray(commands.status, terminalStatuses),
          not(eq(commands.mode, 'init')),
        ))
        .orderBy(desc(commands.createdAt))
        .limit(1)
        .get();
      isLatestFinished = latest?.id === command.id;
    }
  }

  return NextResponse.json({
    ...command,
    taskStatus: task?.status ?? null,
    taskLastProviderId: task?.lastProviderId ?? null,
    taskLastMode: task?.lastMode ?? null,
    isLatestFinished,
    hasRunning,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!command) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates = await req.json();

  if (updates.status) {
    const currentStatus = command.status || 'pending';
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(updates.status)) {
      return NextResponse.json(
        { error: `无法从 "${currentStatus}" 转换到 "${updates.status}"` },
        { status: 400 }
      );
    }
  }

  if (updates.status === 'aborted' && command.status === 'running' && command.pid) {
    try {
      process.kill(command.pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(command.pid!, 'SIGKILL'); } catch {}
      }, 5000);
    } catch {}
  }

  const allowedUpdates: Record<string, unknown> = {};
  if (updates.status) allowedUpdates.status = updates.status;
  if (updates.priority !== undefined) allowedUpdates.priority = updates.priority;

  // Allow editing prompt, mode, providerId when command is pending
  if (command.status === 'pending') {
    if (updates.prompt !== undefined) allowedUpdates.prompt = updates.prompt;
    if (updates.mode !== undefined) allowedUpdates.mode = updates.mode;
    if (updates.providerId !== undefined) allowedUpdates.providerId = updates.providerId;
  }

  if (updates.status === 'aborted' || updates.status === 'failed') {
    allowedUpdates.finishedAt = new Date().toISOString();
  }

  db.update(commands).set(allowedUpdates).where(eq(commands.id, id)).run();
  const updated = db.select().from(commands).where(eq(commands.id, id)).get();
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!command) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (command.status !== 'pending') {
    return NextResponse.json({ error: '只能删除 pending 状态的命令' }, { status: 400 });
  }

  db.delete(commands).where(eq(commands.id, id)).run();
  return NextResponse.json({ ok: true });
}
