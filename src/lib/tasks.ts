import { db } from '@/lib/db';
import { tasks, projects } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const BRANCH_REGEX = /^[a-z0-9-]+$/;

type CreateTaskResult =
  | { ok: true; task: typeof tasks.$inferSelect }
  | { ok: false; error: string; code: 'not_found' | 'validation' | 'conflict' | 'internal' };

interface CreateTaskParams {
  projectId: string;
  description: string;
  branch?: string;
  baseBranch?: string;
}

export function createTask(params: CreateTaskParams): CreateTaskResult {
  const { projectId, description, branch: rawBranch, baseBranch: rawBaseBranch } = params;

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) {
    return { ok: false, error: 'Project not found', code: 'not_found' };
  }

  if (!description) {
    return { ok: false, error: '任务名称不能为空', code: 'validation' };
  }

  const taskId = uuid();
  const branch = rawBranch?.trim() || `task-${taskId.split('-')[0]}`;
  const baseBranch = rawBaseBranch?.trim() || 'main';

  if (!BRANCH_REGEX.test(branch)) {
    return { ok: false, error: '分支名仅允许小写字母、数字和连字符', code: 'validation' };
  }

  // Check repo has at least one commit
  try {
    execFileSync('git', ['-C', project.workDir, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf-8' });
  } catch {
    return { ok: false, error: '仓库尚无任何提交，请先在仓库中创建至少一次提交', code: 'validation' };
  }

  // Check base branch exists (local or remote tracking)
  let resolvedBaseBranch = baseBranch;
  try {
    const localExists = execFileSync('git', ['-C', project.workDir, 'branch', '--list', baseBranch], { encoding: 'utf-8' }).trim();
    if (!localExists) {
      const remoteExists = execFileSync('git', ['-C', project.workDir, 'branch', '-r', '--list', `origin/${baseBranch}`], { encoding: 'utf-8' }).trim();
      if (!remoteExists) {
        return { ok: false, error: `基准分支 "${baseBranch}" 不存在`, code: 'validation' };
      }
      resolvedBaseBranch = `origin/${baseBranch}`;
    }
  } catch (e) {
    return { ok: false, error: `检查基准分支失败: ${(e as Error).message}`, code: 'internal' };
  }

  // Check branch conflict
  try {
    const existing = execFileSync('git', ['-C', project.workDir, 'branch', '--list', branch], { encoding: 'utf-8' }).trim();
    if (existing) {
      return { ok: false, error: `分支 "${branch}" 已存在`, code: 'conflict' };
    }
  } catch (e) {
    return { ok: false, error: `检查分支失败: ${(e as Error).message}`, code: 'internal' };
  }

  // Ensure .worktrees directory exists
  const worktreesBase = join(project.workDir, '.worktrees');
  if (!existsSync(worktreesBase)) {
    mkdirSync(worktreesBase, { recursive: true });
  }

  // Atomic: create branch + worktree
  const worktreeDir = join(worktreesBase, branch);
  try {
    execFileSync('git', ['-C', project.workDir, 'worktree', 'add', worktreeDir, '-b', branch, resolvedBaseBranch], { encoding: 'utf-8' });
  } catch (e) {
    return { ok: false, error: `创建 worktree 失败: ${(e as Error).message}`, code: 'internal' };
  }

  // Insert task record
  db.insert(tasks).values({
    id: taskId,
    projectId,
    description,
    branch,
    worktreeDir,
  }).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()!;
  return { ok: true, task };
}
