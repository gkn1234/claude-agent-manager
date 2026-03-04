import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, projects } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const BRANCH_REGEX = /^[a-z0-9-]+$/;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { description, branch: rawBranch, baseBranch: rawBaseBranch } = await req.json();
  if (!description) return NextResponse.json({ error: '任务名称不能为空' }, { status: 400 });

  const taskId = uuid();
  const branch = rawBranch?.trim() || `task-${taskId.split('-')[0]}`;
  const baseBranch = rawBaseBranch?.trim() || 'main';

  // Validate branch format
  if (!BRANCH_REGEX.test(branch)) {
    return NextResponse.json({ error: '分支名仅允许小写字母、数字和连字符' }, { status: 400 });
  }

  // Check base branch exists
  try {
    const baseExists = execFileSync('git', ['-C', project.workDir, 'branch', '--list', baseBranch], { encoding: 'utf-8' }).trim();
    if (!baseExists) {
      return NextResponse.json({ error: `基准分支 "${baseBranch}" 不存在` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: `检查基准分支失败: ${(e as Error).message}` }, { status: 500 });
  }

  // Check branch conflict
  try {
    const existing = execFileSync('git', ['-C', project.workDir, 'branch', '--list', branch], { encoding: 'utf-8' }).trim();
    if (existing) {
      return NextResponse.json({ error: `分支 "${branch}" 已存在` }, { status: 409 });
    }
  } catch (e) {
    return NextResponse.json({ error: `检查分支失败: ${(e as Error).message}` }, { status: 500 });
  }

  // Ensure .worktrees directory exists
  const worktreesBase = join(project.workDir, '.worktrees');
  if (!existsSync(worktreesBase)) {
    mkdirSync(worktreesBase, { recursive: true });
  }

  // Atomic: create branch + worktree
  const worktreeDir = join(worktreesBase, branch);
  try {
    execFileSync('git', ['-C', project.workDir, 'worktree', 'add', worktreeDir, '-b', branch, baseBranch], { encoding: 'utf-8' });
  } catch (e) {
    return NextResponse.json({ error: `创建 worktree 失败: ${(e as Error).message}` }, { status: 500 });
  }

  // Insert task record
  db.insert(tasks).values({
    id: taskId,
    projectId,
    description,
    branch,
    worktreeDir,
  }).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  return NextResponse.json(task, { status: 201 });
}
