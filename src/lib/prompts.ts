const MAX_RESULT_LENGTH = 4000;

interface TaskContext {
  description: string;
  worktreeDir: string | null;
  branch: string;
}

interface CommandInfo {
  prompt: string | null;
  status: string | null;
}

interface SafetyNetCommandInfo {
  prompt: string | null;
  status: string | null;
  role: string | null;
  result: string | null;
}

export function buildInitialManagerPrompt(task: TaskContext, goal: string): string {
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

export function buildManagerReviewPrompt(command: CommandInfo, summary: string): string {
  return `以下工作命令已完成，请审查结果并决定下一步。

## Worker 报告
${summary}

## 命令信息
- Prompt: ${command.prompt || '(unknown)'}
- 状态: ${command.status || '(unknown)'}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 如果命令失败：分析原因，决定重试或调整策略
6. 每次回复结束前，你必须调用一个 MCP 工具`;
}

export function buildResumeManagerPrompt(goal: string | null, lastResult: string): string {
  const truncated = lastResult.slice(0, MAX_RESULT_LENGTH);
  return `自主模式已恢复。请审查当前进度并决定下一步。

## 任务目标
${goal || '(no goal set)'}

## 最近命令结果
${truncated}

## 你的行动
1. 审查当前进度
2. 如果需要继续：通过 create_command 派发工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task
5. 每次回复结束前，你必须调用一个 MCP 工具`;
}

export function buildSafetyNetFallbackPrompt(command: SafetyNetCommandInfo): string {
  const resultText = command.result
    ? command.result.slice(0, MAX_RESULT_LENGTH)
    : '(no result available)';

  return `以下工作命令已完成，但未通过 MCP 工具触发后续流程。请审查结果并决定下一步。

## 命令信息
- Prompt: ${command.prompt || '(unknown)'}
- 状态: ${command.status || '(unknown)'}
- 角色: ${command.role || '(unknown)'}

## 命令结果（截取前 ${MAX_RESULT_LENGTH} 字符）
${resultText}

## 你的行动
1. 审查结果是否符合预期
2. 如果需要继续：通过 create_command 派发下一个工作命令
3. 如果目标已达成：调用 complete_task
4. 如果需要用户确认：调用 pause_task 并说明原因
5. 每次回复结束前，你必须调用一个 MCP 工具`;
}

export const WORKER_REPORT_INSTRUCTION = `

---

完成工作后，使用 report_to_manager 工具向管理器报告：
- 完成了什么
- 结果如何
- 是否遇到问题
- 建议的下一步`;
