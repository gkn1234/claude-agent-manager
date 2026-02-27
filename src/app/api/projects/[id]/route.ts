import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, id)).all();
  return NextResponse.json({ ...project, tasks: projectTasks });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, id)).all();
  for (const task of projectTasks) {
    db.delete(commands).where(eq(commands.taskId, task.id)).run();
  }
  db.delete(tasks).where(eq(tasks.projectId, id)).run();
  db.delete(projects).where(eq(projects.id, id)).run();

  return NextResponse.json({ ok: true });
}
