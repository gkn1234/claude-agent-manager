import type { McpContext } from './types';
export type { McpRole, McpContext } from './types';

export function parseMcpContext(params: URLSearchParams): McpContext {
  const rawRole = params.get('role');
  const role: McpContext['role'] =
    rawRole === 'manager' || rawRole === 'worker' ? rawRole : 'manual';
  const commandId = params.get('commandId') ?? undefined;
  const taskId = params.get('taskId') ?? undefined;
  return { role, commandId, taskId };
}
