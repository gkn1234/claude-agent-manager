import { tasks, commands } from '../schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const MAX_AUTONOMOUS_ROUNDS = 20;

interface ReportParams {
  commandId: string;
  summary: string;
}

interface ReportResult {
  ok: boolean;
  error?: string;
  managerCommandCreated: boolean;
}

export function executeReportToManager(db: any, params: ReportParams): ReportResult {
  const { commandId, summary } = params;

  const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
  if (!command) {
    return { ok: false, error: `Command ${commandId} not found`, managerCommandCreated: false };
  }

  // 1. Write summary to command
  db.update(commands).set({ managerSummary: summary }).where(eq(commands.id, commandId)).run();

  const task = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();
  if (!task) {
    return { ok: false, error: `Task ${command.taskId} not found`, managerCommandCreated: false };
  }

  // 2. Check task mode
  if (task.mode !== 'autonomous') {
    return { ok: true, managerCommandCreated: false };
  }

  // 3. Increment round
  const newRound = (task.autonomousRound || 0) + 1;
  db.update(tasks).set({ autonomousRound: newRound }).where(eq(tasks.id, task.id)).run();

  // 4. Check round limit
  if (newRound >= MAX_AUTONOMOUS_ROUNDS) {
    db.update(tasks).set({ mode: 'manual' }).where(eq(tasks.id, task.id)).run();
    return { ok: true, managerCommandCreated: false };
  }

  // 5. Create manager review command
  const managerCommandId = uuid();
  const reviewPrompt = buildManagerReviewPrompt(command, summary);

  db.insert(commands).values({
    id: managerCommandId,
    taskId: task.id,
    prompt: reviewPrompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: task.managerProviderId,
    sessionId: task.managerSessionId,
    priority: 0,
  }).run();

  return { ok: true, managerCommandCreated: true };
}

function buildManagerReviewPrompt(command: any, summary: string): string {
  return `以下工作命令已完成，请审查结果并决定下一步。

## Worker 报告
${summary}

## 命令信息
- Prompt: ${command.prompt}
- 状态: ${command.status}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 如果命令失败：分析原因，决定重试或调整策略
6. 每次回复结束前，你必须调用一个 MCP 工具`;
}
