import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 3000}`;

const server = new McpServer({
  name: 'dispatch-system',
  version: '1.0.0',
});

/**
 * create_task - Create a sub-task for a project
 * Used by Claude to autonomously split work into smaller tasks
 */
server.registerTool(
  'create_task',
  {
    description: 'Create a new task under a project. Use this to split work into sub-tasks.',
    inputSchema: z.object({
      projectId: z.string().describe('The project ID to create the task under'),
      description: z.string().describe('Description of the task to create'),
    }),
  },
  async ({ projectId, description }) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: 'text' as const, text: `Error creating task: ${res.status} ${error}` }],
          isError: true,
        };
      }

      const task = await res.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Failed to create task: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/**
 * update_command - Update a command's status
 * Used by Claude to report progress or completion
 */
server.registerTool(
  'update_command',
  {
    description: 'Update the status of a command. Use to report progress or mark completion.',
    inputSchema: z.object({
      commandId: z.string().describe('The command ID to update'),
      status: z.string().describe('New status: queued, running, completed, failed, aborted'),
      result: z.string().optional().describe('Optional result text'),
    }),
  },
  async ({ commandId, status, result }) => {
    try {
      const body: Record<string, string> = { status };
      if (result) body.result = result;

      const res = await fetch(`${API_BASE}/api/commands/${commandId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: 'text' as const, text: `Error updating command: ${res.status} ${error}` }],
          isError: true,
        };
      }

      const command = await res.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(command, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Failed to update command: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/**
 * get_task_context - Get full context for a task
 * Returns task info with all commands history
 */
server.registerTool(
  'get_task_context',
  {
    description: 'Get full context for a task including its commands history.',
    inputSchema: z.object({
      taskId: z.string().describe('The task ID to get context for'),
    }),
  },
  async ({ taskId }) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${taskId}`);

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: 'text' as const, text: `Error getting task: ${res.status} ${error}` }],
          isError: true,
        };
      }

      const task = await res.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Failed to get task: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

/**
 * list_tasks - List all tasks for a project
 * Useful for seeing related tasks and overall progress
 */
server.registerTool(
  'list_tasks',
  {
    description: 'List all tasks for a project to see related work and progress.',
    inputSchema: z.object({
      projectId: z.string().describe('The project ID to list tasks for'),
    }),
  },
  async ({ projectId }) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks?project_id=${projectId}`);

      if (!res.ok) {
        const error = await res.text();
        return {
          content: [{ type: 'text' as const, text: `Error listing tasks: ${res.status} ${error}` }],
          isError: true,
        };
      }

      const taskList = await res.json();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(taskList, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Failed to list tasks: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
