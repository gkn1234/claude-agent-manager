import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands, projects } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getConfig } from '@/lib/config';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { description } = await req.json();
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 });

  const taskId = uuid();
  db.insert(tasks).values({
    id: taskId,
    projectId,
    description,
    status: 'initializing',
  }).run();

  // Auto-create initialization command
  const commandId = uuid();
  const initTemplate = getConfig('init_prompt');
  const initPrompt = initTemplate
    .replace(/\{workDir\}/g, project.workDir)
    .replace(/\{description\}/g, description);

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt: initPrompt,
    mode: 'init',
    status: 'queued',
    priority: 10,
  }).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  return NextResponse.json(task, { status: 201 });
}
