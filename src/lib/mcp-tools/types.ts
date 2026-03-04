export type McpRole = 'manager' | 'worker' | 'manual';

export interface McpContext {
  role: McpRole;
  commandId?: string;
  taskId?: string;
}
