import { tasks, commands } from '../schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const WORKER_REPORT_INSTRUCTION = `

---

完成工作后，使用 report_to_manager 工具向管理器报告：
- 完成了什么
- 结果如何
- 是否遇到问题
- 建议的下一步`;

interface CreateCommandParams {
  taskId: string;
  prompt: string;
  mode: string;
}

type CreateCommandResult =
  | { ok: true; command: typeof commands.$inferSelect }
  | { ok: false; error: string };

export function executeCreateCommand(db: any, params: CreateCommandParams): CreateCommandResult {
  const { taskId, prompt, mode } = params;

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) {
    return { ok: false, error: `Task ${taskId} not found` };
  }

  if (!task.workerProviderId) {
    return { ok: false, error: 'Task has no workerProviderId configured' };
  }

  const commandId = uuid();
  const fullPrompt = prompt + WORKER_REPORT_INSTRUCTION;

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt: fullPrompt,
    mode: mode || 'execute',
    status: 'queued',
    role: 'worker',
    providerId: task.workerProviderId,
    priority: 0,
  }).run();

  const command = db.select().from(commands).where(eq(commands.id, commandId)).get()!;
  return { ok: true, command };
}
