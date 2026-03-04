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
