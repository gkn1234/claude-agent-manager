import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const taskCommands = db.select().from(commands).where(eq(commands.taskId, id)).all();
  return NextResponse.json({ ...task, commands: taskCommands });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (task.worktreeDir && existsSync(task.worktreeDir)) {
    try {
      execSync(`git worktree remove "${task.worktreeDir}" --force`, { encoding: 'utf-8' });
    } catch {
      // Force remove directory if git worktree remove fails
    }
  }

  db.delete(commands).where(eq(commands.taskId, id)).run();
  db.delete(tasks).where(eq(tasks.id, id)).run();

  return NextResponse.json({ ok: true });
}
