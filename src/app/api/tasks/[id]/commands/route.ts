import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Only allow creating commands when task is ready
  if (task.status !== 'ready') {
    return NextResponse.json({ error: '任务尚未就绪，请等待初始化和调研完成' }, { status: 403 });
  }

  const running = db.select().from(commands)
    .where(and(eq(commands.taskId, taskId), eq(commands.status, 'running')))
    .get();
  if (running) {
    return NextResponse.json({ error: 'Task has a running command' }, { status: 409 });
  }

  const { prompt, mode = 'execute', autoQueue = true } = await req.json();
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

  const id = uuid();
  db.insert(commands).values({
    id,
    taskId,
    prompt,
    mode,
    status: autoQueue ? 'queued' : 'pending',
  }).run();

  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  return NextResponse.json(command, { status: 201 });
}
