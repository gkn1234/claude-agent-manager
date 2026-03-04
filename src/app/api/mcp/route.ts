import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { createTask } from '@/lib/tasks';
import { parseMcpContext, type McpContext } from '@/lib/mcp-tools';
import { executeCreateCommand, executeCompleteTask, executePauseTask } from '@/lib/mcp-tools/manager-tools';
import { executeReportToManager } from '@/lib/mcp-tools/worker-tools';

function createServer(context: McpContext): McpServer {
  const server = new McpServer({
    name: 'dispatch-system',
    version: '1.0.0',
  });

  // === Manager-only tools ===
  if (context.role === 'manager') {
    server.registerTool(
      'create_command',
      {
        description: 'Create a worker command to execute a task. The taskId and providerId are auto-injected.',
        inputSchema: z.object({
          prompt: z.string().describe('The work instruction for the worker'),
          mode: z.string().default('execute').describe("'execute' or 'plan'"),
        }),
      },
      async ({ prompt, mode }) => {
        const result = executeCreateCommand(db, {
          taskId: context.taskId!,
          prompt,
          mode,
        });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: `Worker command created: ${result.command.id}` }] };
      }
    );

    server.registerTool(
      'complete_task',
      {
        description: 'Mark the task as completed. Switches task to manual mode.',
        inputSchema: z.object({
          summary: z.string().describe('Completion summary'),
        }),
      },
      async ({ summary }) => {
        const result = executeCompleteTask(db, { taskId: context.taskId!, summary });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: 'Task marked as completed.' }] };
      }
    );

    server.registerTool(
      'pause_task',
      {
        description: 'Pause the task and wait for user confirmation. Switches to manual mode.',
        inputSchema: z.object({
          reason: z.string().describe('Why the task is paused and what user needs to decide'),
        }),
      },
      async ({ reason }) => {
        const result = executePauseTask(db, { taskId: context.taskId!, reason });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: 'Task paused, waiting for user.' }] };
      }
    );
  }

  // === Worker-only tools ===
  if (context.role === 'worker') {
    server.registerTool(
      'report_to_manager',
      {
        description: 'Report work results to the manager. Automatically triggers manager review if in autonomous mode.',
        inputSchema: z.object({
          summary: z.string().describe('Structured summary: what was done, results, issues, suggested next steps'),
        }),
      },
      async ({ summary }) => {
        const result = executeReportToManager(db, {
          commandId: context.commandId!,
          summary,
        });
        if (!result.ok) {
          return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
        }
        const msg = result.managerCommandCreated
          ? 'Report saved. Manager review scheduled.'
          : 'Report saved. No further action (manual mode or round limit reached).';
        return { content: [{ type: 'text' as const, text: msg }] };
      }
    );
  }

  // === Shared tools ===

  // create_task — manual and manager only
  if (context.role === 'manual' || context.role === 'manager') {
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
  }

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
        const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
        if (!command) {
          return { content: [{ type: 'text' as const, text: `Error: Command ${commandId} not found` }], isError: true };
        }
        db.update(commands).set({
          status,
          ...(result ? { result } : {}),
        }).where(eq(commands.id, commandId)).run();
        const updated = db.select().from(commands).where(eq(commands.id, commandId)).get();
        return { content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

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
          return { content: [{ type: 'text' as const, text: `Error: Task ${taskId} not found` }], isError: true };
        }
        const taskCommands = db.select().from(commands).where(eq(commands.taskId, taskId)).all();
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ...task, commands: taskCommands }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

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
        return { content: [{ type: 'text' as const, text: JSON.stringify(taskList, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const context = parseMcpContext(url.searchParams);
  const server = createServer(context);
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
