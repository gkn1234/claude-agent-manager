import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, tasks } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { cleanupTask } from '@/lib/claude-runner';

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
    cleanupTask(task.id);
  }
  db.delete(projects).where(eq(projects.id, id)).run();

  return NextResponse.json({ ok: true });
}
