import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands, projects } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

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
  const initPrompt = `你正在一个任务派发系统中工作。请基于以下任务描述完成初始化：

1. 在项目工作目录 ${project.workDir} 下的 .worktrees/ 目录中创建 git worktree 作为本任务的工作空间
2. 分支命名格式：task/${taskId.slice(0, 8)}
3. 理解项目结构
4. 如果任务过于庞大，请通过 MCP create_task 工具拆分为多个子任务

任务描述：${description}`;

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt: initPrompt,
    mode: 'execute',
    status: 'queued',
    priority: 10,
  }).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  return NextResponse.json(task, { status: 201 });
}
