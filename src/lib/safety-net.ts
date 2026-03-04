import { tasks, commands } from './schema';
import { eq, and, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const MAX_RESULT_LENGTH = 4000;

export function checkAndRecoverAutonomousTask(
  db: any,
  taskId: string,
  finishedCommandId: string,
): boolean {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task || task.mode !== 'autonomous') return false;

  const activeCommands = db.select()
    .from(commands)
    .where(
      and(
        eq(commands.taskId, taskId),
        inArray(commands.status, ['queued', 'running']),
      )
    )
    .all();

  if (activeCommands.length > 0) return false;

  const finishedCommand = db.select().from(commands).where(eq(commands.id, finishedCommandId)).get();
  const resultText = finishedCommand?.result
    ? finishedCommand.result.slice(0, MAX_RESULT_LENGTH)
    : '(no result available)';

  const fallbackPrompt = `以下工作命令已完成，但未通过 MCP 工具触发后续流程。请审查结果并决定下一步。

## 命令信息
- Prompt: ${finishedCommand?.prompt || '(unknown)'}
- 状态: ${finishedCommand?.status || '(unknown)'}
- 角色: ${finishedCommand?.role || '(unknown)'}

## 命令结果（截取前 ${MAX_RESULT_LENGTH} 字符）
${resultText}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 每次回复结束前，你必须调用一个 MCP 工具`;

  const managerCommandId = uuid();
  db.insert(commands).values({
    id: managerCommandId,
    taskId,
    prompt: fallbackPrompt,
    mode: 'plan',
    status: 'queued',
    role: 'manager',
    providerId: task.managerProviderId,
    sessionId: task.managerSessionId,
    priority: 0,
  }).run();

  console.log(`[SafetyNet] Created fallback manager command ${managerCommandId} for task ${taskId}`);
  return true;
}
