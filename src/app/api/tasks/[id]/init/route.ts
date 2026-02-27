import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands, projects, providers } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getConfig } from '@/lib/config';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  if (task.status !== 'pending') {
    return NextResponse.json({ error: '任务已初始化' }, { status: 409 });
  }

  const { providerId } = await req.json();
  if (!providerId) return NextResponse.json({ error: '请选择 Provider' }, { status: 400 });

  const provider = db.select().from(providers).where(eq(providers.id, providerId)).get();
  if (!provider) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Update task status
  db.update(tasks).set({
    status: 'initializing',
    lastProviderId: providerId,
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run();

  // Create init command
  const commandId = uuid();
  const initTemplate = getConfig('init_prompt');
  const initPrompt = initTemplate
    .replace(/\{workDir\}/g, project.workDir)
    .replace(/\{description\}/g, task.description);

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt: initPrompt,
    mode: 'init',
    status: 'queued',
    priority: 10,
    providerId,
  }).run();

  return NextResponse.json({ ok: true }, { status: 201 });
}
