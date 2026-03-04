import { describe, it, expect } from 'vitest';
import { parseMcpContext } from '../mcp-tools';

describe('parseMcpContext', () => {
  it('should parse manual context when no params', () => {
    const ctx = parseMcpContext(new URLSearchParams());
    expect(ctx.role).toBe('manual');
    expect(ctx.commandId).toBeUndefined();
    expect(ctx.taskId).toBeUndefined();
  });

  it('should parse manager context', () => {
    const ctx = parseMcpContext(new URLSearchParams('role=manager&commandId=cmd-1&taskId=task-1'));
    expect(ctx.role).toBe('manager');
    expect(ctx.commandId).toBe('cmd-1');
    expect(ctx.taskId).toBe('task-1');
  });

  it('should parse worker context', () => {
    const ctx = parseMcpContext(new URLSearchParams('role=worker&commandId=cmd-2&taskId=task-2'));
    expect(ctx.role).toBe('worker');
    expect(ctx.commandId).toBe('cmd-2');
    expect(ctx.taskId).toBe('task-2');
  });

  it('should default to manual for unknown role', () => {
    const ctx = parseMcpContext(new URLSearchParams('role=unknown'));
    expect(ctx.role).toBe('manual');
  });
});
