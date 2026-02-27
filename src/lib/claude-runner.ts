import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { db } from './db';
import { commands, tasks, projects } from './schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getConfig } from './config';

const LOG_DIR = process.env.LOG_DIR || './logs';

export interface RunningProcess {
  pid: number;
  commandId: string;
  process: ChildProcess;
}

export const runningProcesses = new Map<string, RunningProcess>();

export async function runCommand(commandId: string): Promise<void> {
  const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
  if (!command) throw new Error('Command not found');

  const task = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();
  if (!task) throw new Error('Task not found');

  // Get project for work directory fallback
  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (!project) throw new Error('Project not found');

  // Use worktree dir if available, otherwise project work dir
  const cwd = task.worktreeDir || project.workDir;

  // Ensure log directory
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${commandId}.ndjson`);
  const logStream = createWriteStream(logFile, { flags: 'a' });

  // Build claude command args
  const args = [
    '-p', command.prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ];

  // Add plan mode flag if needed
  if (command.mode === 'plan' || command.mode === 'research') {
    args.push('--plan');
  }

  // Inject MCP config if available
  const mcpConfigPath = join(process.cwd(), 'mcp-config.json');
  if (existsSync(mcpConfigPath)) {
    args.push('--mcp-config', mcpConfigPath);
  }

  // Resume session if available (skip init/research commands for session isolation)
  const prevCommand = db.select()
    .from(commands)
    .where(eq(commands.taskId, command.taskId))
    .all()
    .filter(c => c.sessionId && c.id !== commandId && c.mode !== 'init' && c.mode !== 'research')
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .pop();

  if (prevCommand?.sessionId) {
    args.push('--resume', prevCommand.sessionId);
  }

  // Spawn claude process
  const child = spawn('claude', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  if (!child.pid) {
    db.update(commands).set({
      status: 'failed',
      result: 'Failed to spawn claude process',
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();
    logStream.end();
    return;
  }

  // Update command with PID and status
  db.update(commands).set({
    status: 'running',
    pid: child.pid,
    logFile,
    startedAt: new Date().toISOString(),
  }).where(eq(commands.id, commandId)).run();

  runningProcesses.set(commandId, { pid: child.pid, commandId, process: child });

  let lastResult = '';
  let sessionId = '';
  let stderr = '';

  // Parse stream-json output line by line
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      logStream.write(line + '\n');

      try {
        const event = JSON.parse(line);
        if (event.session_id && !sessionId) {
          sessionId = event.session_id;
        }
        if (event.type === 'result') {
          lastResult = event.result || '';
          sessionId = event.session_id || sessionId;
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    logStream.end();
    runningProcesses.delete(commandId);

    const finalStatus = code === 0 ? 'completed' : 'failed';
    const result = code === 0
      ? lastResult || 'Command completed'
      : `Exit code: ${code}\n${stderr}`.trim();

    db.update(commands).set({
      status: finalStatus,
      result,
      sessionId: sessionId || null,
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();

    // If init command succeeded, find worktreeDir and create research command
    if (code === 0 && command.mode === 'init') {
      const taskData = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();
      const projectData = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
      if (taskData && projectData) {
        // Scan .worktrees/ to find the newly created worktree directory
        const worktreesBase = join(projectData.workDir, '.worktrees');
        let worktreeDir: string | null = null;
        if (existsSync(worktreesBase)) {
          try {
            const dirs = readdirSync(worktreesBase, { withFileTypes: true })
              .filter(d => d.isDirectory())
              .sort((a, b) => b.name.localeCompare(a.name)); // newest name first as heuristic
            if (dirs.length > 0) {
              // Pick the most recently created directory
              worktreeDir = join(worktreesBase, dirs[0].name);
            }
          } catch {}
        }

        // Update task: set worktreeDir and status to researching
        db.update(tasks).set({
          status: 'researching',
          ...(worktreeDir ? { worktreeDir } : {}),
          updatedAt: new Date().toISOString(),
        }).where(eq(tasks.id, command.taskId)).run();

        // Auto-create research command
        const researchId = uuid();
        const researchTemplate = getConfig('research_prompt');
        const researchPrompt = researchTemplate.replace('{description}', taskData.description);

        db.insert(commands).values({
          id: researchId,
          taskId: command.taskId,
          prompt: researchPrompt,
          mode: 'research',
          status: 'queued',
          priority: 10,
        }).run();
      }
    }

    // If research command succeeded, update task status to ready
    if (code === 0 && command.mode === 'research') {
      db.update(tasks).set({
        status: 'ready',
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, command.taskId)).run();
    }
  });

  child.on('error', (err) => {
    logStream.end();
    runningProcesses.delete(commandId);
    db.update(commands).set({
      status: 'failed',
      result: `Process error: ${err.message}`,
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();
  });

  // Timeout handler
  const timeout = parseInt(process.env.COMMAND_TIMEOUT || '1800') * 1000;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const timer = setTimeout(() => {
    if (runningProcesses.has(commandId)) {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    }
  }, timeout);
}
