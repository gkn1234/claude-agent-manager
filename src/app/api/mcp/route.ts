import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { createTask } from '@/lib/tasks';

function createServer(): McpServer {
  const server = new McpServer({
    name: 'dispatch-system',
    version: '1.0.0',
  });

  /**
   * create_task - Create a sub-task for a project
   */
  server.registerTool(
    'create_task',
    {
      description: 'Create a new task under a project with an isolated git worktree.',
      inputSchema: z.object({
        projectId: z.string().describe('The project ID to create the task under'),
        description: z.string().describe('Name/description of the task'),
        branch: z.string().optional().describe('Git branch name (lowercase, digits, hyphens only). Auto-generated if omitted.'),
        baseBranch: z.string().optional().describe('Base branch to create from (start-point). Defaults to "main" if omitted.'),
      }),
    },
    async ({ projectId, description, branch, baseBranch }) => {
      const result = createTask({ projectId, description, branch, baseBranch });
      if (!result.ok) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.task, null, 2) }] };
    }
  );

  /**
   * update_command - Update a command's status
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

        const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
        if (!command) {
          return {
            content: [{ type: 'text' as const, text: `Error: Command ${commandId} not found` }],
            isError: true,
          };
        }

        db.update(commands).set({
          status,
          ...(result ? { result } : {}),
        }).where(eq(commands.id, commandId)).run();

        const updated = db.select().from(commands).where(eq(commands.id, commandId)).get();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }],
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
        const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
        if (!task) {
          return {
            content: [{ type: 'text' as const, text: `Error: Task ${taskId} not found` }],
            isError: true,
          };
        }

        const taskCommands = db.select().from(commands).where(eq(commands.taskId, taskId)).all();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ ...task, commands: taskCommands }, null, 2) }],
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
        const taskList = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
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

  return server;
}

export async function POST(request: Request) {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function GET(request: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  return transport.handleRequest(request);
}

export async function DELETE(request: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  return transport.handleRequest(request);
}
