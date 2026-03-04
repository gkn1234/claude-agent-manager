import { describe, it, expect } from 'vitest';
import { getToolNamesForRole } from '../mcp-tools';

describe('getToolNamesForRole', () => {
  it('should return manager-specific tools for manager role', () => {
    const tools = getToolNamesForRole('manager');
    expect(tools).toContain('create_command');
    expect(tools).toContain('complete_task');
    expect(tools).toContain('pause_task');
    expect(tools).toContain('create_task');
    expect(tools).not.toContain('report_to_manager');
  });

  it('should return worker-specific tools for worker role', () => {
    const tools = getToolNamesForRole('worker');
    expect(tools).toContain('report_to_manager');
    expect(tools).not.toContain('create_command');
    expect(tools).not.toContain('complete_task');
    expect(tools).not.toContain('pause_task');
    expect(tools).not.toContain('create_task');
  });

  it('should return manual tools for manual role', () => {
    const tools = getToolNamesForRole('manual');
    expect(tools).toContain('create_task');
    expect(tools).toContain('update_command');
    expect(tools).toContain('get_task_context');
    expect(tools).toContain('list_tasks');
    expect(tools).not.toContain('create_command');
    expect(tools).not.toContain('report_to_manager');
  });

  it('should include shared tools for all roles', () => {
    for (const role of ['manager', 'worker', 'manual'] as const) {
      const tools = getToolNamesForRole(role);
      expect(tools).toContain('update_command');
      expect(tools).toContain('get_task_context');
      expect(tools).toContain('list_tasks');
    }
  });
});
