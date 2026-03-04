import { describe, it, expect } from 'vitest';
import { buildMcpUrl } from '../mcp-tools';

describe('buildMcpUrl', () => {
  const baseUrl = 'http://localhost:3000/api/mcp';

  it('should build manager MCP URL with context', () => {
    const url = buildMcpUrl(baseUrl, { role: 'manager', commandId: 'cmd-1', taskId: 'task-1' });
    expect(url).toBe('http://localhost:3000/api/mcp?role=manager&commandId=cmd-1&taskId=task-1');
  });

  it('should build worker MCP URL with context', () => {
    const url = buildMcpUrl(baseUrl, { role: 'worker', commandId: 'cmd-2', taskId: 'task-2' });
    expect(url).toBe('http://localhost:3000/api/mcp?role=worker&commandId=cmd-2&taskId=task-2');
  });

  it('should build manual MCP URL without context params', () => {
    const url = buildMcpUrl(baseUrl, { role: 'manual' });
    expect(url).toBe('http://localhost:3000/api/mcp');
  });
});
