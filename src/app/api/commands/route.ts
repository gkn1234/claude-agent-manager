import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands, tasks, projects, providers } from '@/lib/schema';
import { asc, desc, eq } from 'drizzle-orm';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const projectId = searchParams.get('project_id');
  const taskId = searchParams.get('task_id');

  const result = db.select({
    id: commands.id,
    taskId: commands.taskId,
    prompt: commands.prompt,
    mode: commands.mode,
    status: commands.status,
    priority: commands.priority,
    result: commands.result,
    startedAt: commands.startedAt,
    finishedAt: commands.finishedAt,
    createdAt: commands.createdAt,
    taskDescription: tasks.description,
    projectId: tasks.projectId,
    projectName: projects.name,
    providerName: providers.name,
  })
  .from(commands)
  .innerJoin(tasks, eq(commands.taskId, tasks.id))
  .innerJoin(projects, eq(tasks.projectId, projects.id))
  .leftJoin(providers, eq(commands.providerId, providers.id))
  .orderBy(desc(commands.priority), asc(commands.createdAt))
  .all();

  let filtered = result;
  if (status) filtered = filtered.filter(c => c.status === status);
  if (projectId) filtered = filtered.filter(c => c.projectId === projectId);
  if (taskId) filtered = filtered.filter(c => c.taskId === taskId);

  return NextResponse.json(filtered);
}
