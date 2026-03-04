import { tasks, commands } from './schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

type Result = { ok: true } | { ok: false; error: string };

interface StartParams {
  taskId: string;
  goal: string;
  managerProviderId: string;
  workerProviderId: string;
}

export function startAutonomous(db: any, params: StartParams): Result {
  const { taskId, goal, managerProviderId, workerProviderId } = params;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };
  if (task.mode === 'autonomous') return { ok: false, error: 'Task is already in autonomous mode' };

  db.update(tasks).set({
    mode: 'autonomous',
    goal,
    managerProviderId,
    workerProviderId,
    autonomousRound: 0,
    managerSessionId: null,
  }).where(eq(tasks.id, taskId)).run();

  const commandId = uuid();
  const prompt = buildInitialManagerPrompt(task, goal);

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: managerProviderId,
    priority: 0,
  }).run();

  return { ok: true };
}

interface PauseParams { taskId: string; }

export function pauseAutonomous(db: any, params: PauseParams): Result {
  const { taskId } = params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };

  db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, taskId)).run();
  return { ok: true };
}

interface ResumeParams { taskId: string; }

export function resumeAutonomous(db: any, params: ResumeParams): Result {
  const { taskId } = params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'Task not found' };
  if (!task.managerProviderId) return { ok: false, error: 'Task has no managerProviderId' };

  db.update(tasks).set({ mode: 'autonomous' }).where(eq(tasks.id, taskId)).run();

  const lastCmd = db.select().from(commands)
    .where(eq(commands.taskId, taskId))
    .orderBy(desc(commands.createdAt))
    .limit(1)
    .get();

  const lastSummary = lastCmd?.managerSummary || lastCmd?.result || '(no previous results)';

  const commandId = uuid();
  const prompt = `自主模式已恢复。请审查当前进度并决定下一步。

## 任务目标
${task.goal || '(no goal set)'}

## 最近命令结果
${(lastSummary as string).slice(0, 4000)}

## 你的行动
1. 审查当前进度
2. 如果需要继续：通过 create_command 派发工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task
5. 每次回复结束前，你必须调用一个 MCP 工具`;

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: task.managerProviderId,
    sessionId: task.managerSessionId || null,
    priority: 0,
  }).run();

  return { ok: true };
}

function buildInitialManagerPrompt(task: any, goal: string): string {
  return `你是 Claude Dispatch 任务管理器（Manager）。你的职责是自主推进目标的完成。

## 任务目标
${goal}

## 当前工作环境
- 任务: ${task.description}
- 工作目录: ${task.worktreeDir || '(pending)'}
- 分支: ${task.branch}

## 可用 MCP 工具
- create_command: 派发工作命令（指定 prompt 和 mode）
- complete_task: 宣告目标完成（附完成摘要）
- pause_task: 暂停任务，请求用户确认（附暂停原因）
- get_task_context: 获取任务上下文和命令历史
- list_tasks: 列出项目下所有任务

## 工作方式
1. 先分析代码库和目标，制定实施计划
2. 将计划拆解为工作命令，通过 create_command 逐个派发
3. 工作命令会由独立的 Claude CLI 进程在同一工作目录执行
4. 你不需要直接写代码，只需要规划和派发
5. 每次回复结束前，你必须调用一个 MCP 工具

## 注意事项
- 每次只派发一个 worker 命令，等待其完成后再决定下一步
- 你调用 create_command 后即可结束回复，系统会自动安排执行
- Worker 完成后你会收到其报告，届时再审查并决定下一步`;
}
