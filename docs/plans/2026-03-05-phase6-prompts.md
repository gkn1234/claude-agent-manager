# Phase 6: 提示词模板集中化 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将分散在 autonomous.ts、worker-tools.ts、safety-net.ts 中的 5 个提示词模板集中到 `src/lib/prompts.ts` 统一模块，确保与设计文档一致，便于未来维护和国际化。

**Architecture:** 创建 `src/lib/prompts.ts` 导出所有提示词生成函数，原模块改为导入调用。通过 TDD 确保提示词内容符合设计文档规格。

**Tech Stack:** TypeScript, Vitest

**Design Doc:** `docs/plans/2026-03-05-autonomous-task-manager-design.md` → "提示词设计" 章节

---

## Task 1: TDD — 提示词模块

**Files:**
- Create: `src/lib/__tests__/prompts.test.ts`
- Create: `src/lib/prompts.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildInitialManagerPrompt,
  buildManagerReviewPrompt,
  buildResumeManagerPrompt,
  buildSafetyNetFallbackPrompt,
  WORKER_REPORT_INSTRUCTION,
} from '../prompts';

describe('buildInitialManagerPrompt', () => {
  it('should include goal in prompt', () => {
    const prompt = buildInitialManagerPrompt({
      description: 'Auth module',
      worktreeDir: '/tmp/work',
      branch: 'feat-auth',
    }, 'Build auth module');
    expect(prompt).toContain('Build auth module');
  });

  it('should include task context', () => {
    const prompt = buildInitialManagerPrompt({
      description: 'Auth module',
      worktreeDir: '/tmp/work',
      branch: 'feat-auth',
    }, 'Build auth');
    expect(prompt).toContain('Auth module');
    expect(prompt).toContain('/tmp/work');
    expect(prompt).toContain('feat-auth');
  });

  it('should include MCP tool list', () => {
    const prompt = buildInitialManagerPrompt({
      description: 'Test',
      worktreeDir: null,
      branch: 'main',
    }, 'Goal');
    expect(prompt).toContain('create_command');
    expect(prompt).toContain('complete_task');
    expect(prompt).toContain('pause_task');
    expect(prompt).toContain('get_task_context');
  });

  it('should handle null worktreeDir', () => {
    const prompt = buildInitialManagerPrompt({
      description: 'Test',
      worktreeDir: null,
      branch: 'main',
    }, 'Goal');
    expect(prompt).toContain('(pending)');
  });
});

describe('buildManagerReviewPrompt', () => {
  it('should include worker summary', () => {
    const prompt = buildManagerReviewPrompt({
      prompt: 'Do work',
      status: 'completed',
    }, 'Work is done');
    expect(prompt).toContain('Work is done');
  });

  it('should include command info', () => {
    const prompt = buildManagerReviewPrompt({
      prompt: 'Implement feature X',
      status: 'completed',
    }, 'Done');
    expect(prompt).toContain('Implement feature X');
    expect(prompt).toContain('completed');
  });

  it('should include action instructions', () => {
    const prompt = buildManagerReviewPrompt({
      prompt: 'Do work',
      status: 'completed',
    }, 'Done');
    expect(prompt).toContain('create_command');
    expect(prompt).toContain('complete_task');
    expect(prompt).toContain('pause_task');
  });
});

describe('buildResumeManagerPrompt', () => {
  it('should include goal', () => {
    const prompt = buildResumeManagerPrompt('Build auth', 'Previous result');
    expect(prompt).toContain('Build auth');
  });

  it('should include last result', () => {
    const prompt = buildResumeManagerPrompt('Goal', 'Last work completed');
    expect(prompt).toContain('Last work completed');
  });

  it('should truncate long results to 4000 chars', () => {
    const longResult = 'A'.repeat(5000);
    const prompt = buildResumeManagerPrompt('Goal', longResult);
    expect(prompt.length).toBeLessThan(6000);
  });

  it('should handle null goal', () => {
    const prompt = buildResumeManagerPrompt(null, 'Result');
    expect(prompt).toContain('(no goal set)');
  });
});

describe('buildSafetyNetFallbackPrompt', () => {
  it('should include finished command info', () => {
    const prompt = buildSafetyNetFallbackPrompt({
      prompt: 'Do work',
      status: 'failed',
      role: 'worker',
      result: 'Error occurred',
    });
    expect(prompt).toContain('Do work');
    expect(prompt).toContain('failed');
    expect(prompt).toContain('worker');
  });

  it('should truncate long results', () => {
    const longResult = 'B'.repeat(5000);
    const prompt = buildSafetyNetFallbackPrompt({
      prompt: 'Work',
      status: 'completed',
      role: 'worker',
      result: longResult,
    });
    expect(prompt.length).toBeLessThan(6000);
  });

  it('should handle missing fields', () => {
    const prompt = buildSafetyNetFallbackPrompt({
      prompt: null,
      status: null,
      role: null,
      result: null,
    });
    expect(prompt).toContain('(unknown)');
  });
});

describe('WORKER_REPORT_INSTRUCTION', () => {
  it('should include report_to_manager reference', () => {
    expect(WORKER_REPORT_INSTRUCTION).toContain('report_to_manager');
  });

  it('should list required report items', () => {
    expect(WORKER_REPORT_INSTRUCTION).toContain('完成了什么');
    expect(WORKER_REPORT_INSTRUCTION).toContain('结果如何');
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/prompts.test.ts
```

Expected: FAIL — `../prompts` 不存在

**Step 3: 实现 `src/lib/prompts.ts`**

```typescript
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
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/prompts.test.ts
```

Expected: ALL PASS (16 tests)

**Step 5: Commit**

```bash
git add src/lib/prompts.ts src/lib/__tests__/prompts.test.ts
git commit -m "feat: centralize prompt templates into dedicated module"
```

---

## Task 2: 迁移现有模块使用集中提示词

**Files:**
- Modify: `src/lib/autonomous.ts`
- Modify: `src/lib/mcp-tools/worker-tools.ts`
- Modify: `src/lib/mcp-tools/manager-tools.ts`
- Modify: `src/lib/safety-net.ts`

**Step 1: 修改 autonomous.ts**

1. 在顶部添加导入: `import { buildInitialManagerPrompt, buildResumeManagerPrompt } from './prompts';`
2. 删除底部的 `function buildInitialManagerPrompt(task: any, goal: string): string { ... }` 函数（约 107-136 行）
3. 在 `resumeAutonomous` 中，将内联的恢复提示词替换为:
```typescript
const prompt = buildResumeManagerPrompt(task.goal, lastSummary as string);
```
（替换掉第 77-90 行的 `const prompt = \`自主模式已恢复...\`` 模板字符串）

**Step 2: 修改 manager-tools.ts**

1. 在顶部添加导入: `import { WORKER_REPORT_INSTRUCTION } from '../prompts';`
2. 删除文件顶部的 `const WORKER_REPORT_INSTRUCTION = ...` 常量（约 5-13 行）

**Step 3: 修改 worker-tools.ts**

1. 在顶部添加导入: `import { buildManagerReviewPrompt } from '../prompts';`
2. 删除底部的 `function buildManagerReviewPrompt(command: any, summary: string): string { ... }` 函数（约 68-85 行）

**Step 4: 修改 safety-net.ts**

1. 在顶部添加导入: `import { buildSafetyNetFallbackPrompt } from './prompts';`
2. 删除 `const MAX_RESULT_LENGTH = 4000;` 常量
3. 将 `const fallbackPrompt = \`以下工作命令已完成...\`` 模板字符串替换为:
```typescript
const fallbackPrompt = buildSafetyNetFallbackPrompt({
  prompt: finishedCommand?.prompt || null,
  status: finishedCommand?.status || null,
  role: finishedCommand?.role || null,
  result: finishedCommand?.result || null,
});
```

**Step 5: 运行全量测试 + 构建**

```bash
pnpm test && pnpm build
```

Expected: ALL PASS (77 tests = 61 existing + 16 new) + build success

**Step 6: Commit**

```bash
git add src/lib/autonomous.ts src/lib/mcp-tools/worker-tools.ts src/lib/mcp-tools/manager-tools.ts src/lib/safety-net.ts
git commit -m "refactor: migrate all modules to use centralized prompt templates"
```

---

## Phase 6 完成标准

- [ ] `src/lib/prompts.ts` 集中所有 5 个提示词模板
- [ ] 16 个提示词单元测试通过
- [ ] autonomous.ts 使用 prompts.ts 的函数
- [ ] worker-tools.ts 使用 prompts.ts 的函数
- [ ] manager-tools.ts 使用 prompts.ts 的常量
- [ ] safety-net.ts 使用 prompts.ts 的函数
- [ ] 全量测试通过
- [ ] pnpm build 成功
