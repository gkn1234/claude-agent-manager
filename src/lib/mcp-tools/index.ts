import type { McpRole, McpContext } from './types';
export type { McpRole, McpContext } from './types';

export function parseMcpContext(params: URLSearchParams): McpContext {
  const rawRole = params.get('role');
  const role: McpContext['role'] =
    rawRole === 'manager' || rawRole === 'worker' ? rawRole : 'manual';
  const commandId = params.get('commandId') ?? undefined;
  const taskId = params.get('taskId') ?? undefined;
  return { role, commandId, taskId };
}

const TOOL_REGISTRY: Record<McpRole, string[]> = {
  manager: ['create_command', 'complete_task', 'pause_task', 'create_task', 'update_command', 'get_task_context', 'list_tasks'],
  worker: ['report_to_manager', 'update_command', 'get_task_context', 'list_tasks'],
  manual: ['create_task', 'update_command', 'get_task_context', 'list_tasks'],
};

export function getToolNamesForRole(role: McpRole): string[] {
  return TOOL_REGISTRY[role] || TOOL_REGISTRY.manual;
}

export function buildMcpUrl(baseUrl: string, context: McpContext): string {
  if (context.role === 'manual') return baseUrl;
  const params = new URLSearchParams();
  params.set('role', context.role);
  if (context.commandId) params.set('commandId', context.commandId);
  if (context.taskId) params.set('taskId', context.taskId);
  return `${baseUrl}?${params.toString()}`;
}
