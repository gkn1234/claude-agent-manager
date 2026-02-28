import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const { prompt, mode = 'execute', autoQueue = true, providerId = null } = await req.json();
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  if (!providerId) return NextResponse.json({ error: '请选择 Provider' }, { status: 400 });

  // Only check running command when queuing directly; drafts (pending) are always allowed
  if (autoQueue) {
    const running = db.select().from(commands)
      .where(and(eq(commands.taskId, taskId), eq(commands.status, 'running')))
      .get();
    if (running) {
      return NextResponse.json({ error: '有正在执行的指令，请等待完成后再排队' }, { status: 409 });
    }
  }

  const id = uuid();
  db.insert(commands).values({
    id,
    taskId,
    prompt,
    mode,
    providerId,
    status: autoQueue ? 'queued' : 'pending',
  }).run();

  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  return NextResponse.json(command, { status: 201 });
}
