import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { db } from '@/lib/db';
import { tasks, projects, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

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
      }),
    },
    async ({ projectId, description, branch: rawBranch }) => {
      try {
        const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
        if (!project) {
          return { content: [{ type: 'text' as const, text: `Error: Project ${projectId} not found` }], isError: true };
        }

        const { execFileSync } = await import('child_process');
        const { join } = await import('path');
        const { mkdirSync, existsSync } = await import('fs');

        const taskId = uuid();
        const branch = rawBranch?.trim() || `task-${taskId.split('-')[0]}`;
        const BRANCH_REGEX = /^[a-z0-9-]+$/;

        if (!BRANCH_REGEX.test(branch)) {
          return { content: [{ type: 'text' as const, text: 'Error: branch name must match [a-z0-9-]+' }], isError: true };
        }

        const existing = execFileSync('git', ['-C', project.workDir, 'branch', '--list', branch], { encoding: 'utf-8' }).trim();
        if (existing) {
          return { content: [{ type: 'text' as const, text: `Error: branch "${branch}" already exists` }], isError: true };
        }

        const worktreesBase = join(project.workDir, '.worktrees');
        if (!existsSync(worktreesBase)) mkdirSync(worktreesBase, { recursive: true });

        const worktreeDir = join(worktreesBase, branch);
        execFileSync('git', ['-C', project.workDir, 'worktree', 'add', worktreeDir, '-b', branch], { encoding: 'utf-8' });

        db.insert(tasks).values({ id: taskId, projectId, description, branch, worktreeDir }).run();
        const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
        return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to create task: ${(err as Error).message}` }], isError: true };
      }
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
