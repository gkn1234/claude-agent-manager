import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { cleanupTask } from '@/lib/claude-runner';
import { startAutonomous, pauseAutonomous, resumeAutonomous } from '@/lib/autonomous';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const taskCommands = db.select().from(commands).where(eq(commands.taskId, id)).all();
  return NextResponse.json({ ...task, commands: taskCommands });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  if (body.action === 'start_autonomous') {
    const result = startAutonomous(db, {
      taskId: id,
      goal: body.goal,
      managerProviderId: body.managerProviderId,
      workerProviderId: body.workerProviderId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'pause_autonomous') {
    const result = pauseAutonomous(db, { taskId: id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'resume_autonomous') {
    const result = resumeAutonomous(db, { taskId: id });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.lastProviderId !== undefined) updates.lastProviderId = body.lastProviderId;
  if (body.lastMode !== undefined) updates.lastMode = body.lastMode;

  db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  cleanupTask(id);
  return NextResponse.json({ ok: true });
}
