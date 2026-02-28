import { spawn, ChildProcess, execFileSync } from 'child_process';
import { createWriteStream, mkdirSync, existsSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';
import { db } from './db';
import { commands, tasks, projects, providers } from './schema';
import { eq } from 'drizzle-orm';

const LOG_DIR = process.env.LOG_DIR || './logs';

export interface RunningProcess {
  pid: number;
  commandId: string;
  process: ChildProcess;
}

export const runningProcesses = new Map<string, RunningProcess>();

/**
 * Clean up a task: kill running processes, remove log files, remove git worktree, delete DB records.
 */
export function cleanupTask(taskId: string) {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;

  const taskCommands = db.select().from(commands).where(eq(commands.taskId, taskId)).all();

  for (const cmd of taskCommands) {
    // Kill running process
    const running = runningProcesses.get(cmd.id);
    if (running) {
      try { running.process.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { running.process.kill('SIGKILL'); } catch {} }, 3000);
      runningProcesses.delete(cmd.id);
    }
    // Remove log file
    if (cmd.logFile) {
      try { if (existsSync(cmd.logFile)) unlinkSync(cmd.logFile); } catch {}
    }
  }

  // Remove git worktree and its branch
  if (task.worktreeDir) {
    const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();

    // 1. Get branch name before worktree removal (directory won't exist after)
    let branchToDelete: string | null = null;
    if (existsSync(task.worktreeDir)) {
      try {
        branchToDelete = execFileSync('git', ['-C', task.worktreeDir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
        if (['main', 'master', 'develop'].includes(branchToDelete)) {
          branchToDelete = null;
        }
      } catch (e) {
        console.warn(`[cleanupTask] Failed to get branch name for ${task.worktreeDir}:`, e);
      }
    }

    // 2. Remove worktree — must run in main repo context
    if (project && existsSync(task.worktreeDir)) {
      try {
        execFileSync('git', ['-C', project.workDir, 'worktree', 'remove', task.worktreeDir, '--force'], { encoding: 'utf-8' });
      } catch (e) {
        console.warn(`[cleanupTask] git worktree remove failed:`, e);
        // Fallback: manually remove directory
        try { rmSync(task.worktreeDir, { recursive: true, force: true }); } catch {}
      }
    }

    // 3. Prune stale worktree metadata (ensures branch is no longer seen as checked out)
    if (project) {
      try {
        execFileSync('git', ['-C', project.workDir, 'worktree', 'prune'], { encoding: 'utf-8' });
      } catch {}

      // 4. Delete the branch
      if (branchToDelete) {
        try {
          execFileSync('git', ['-C', project.workDir, 'branch', '-D', branchToDelete], { encoding: 'utf-8' });
        } catch (e) {
          console.warn(`[cleanupTask] Failed to delete branch ${branchToDelete}:`, e);
        }
      }
    }
  }

  // Delete DB records
  db.delete(commands).where(eq(commands.taskId, taskId)).run();
  db.delete(tasks).where(eq(tasks.id, taskId)).run();
}

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
  if (command.mode === 'plan') {
    args.push('--permission-mode', 'plan');
  }

  // Inject MCP config if available — HTTP mode, no path resolution needed
  const mcpConfigPath = join(process.cwd(), 'mcp-config.json');
  if (existsSync(mcpConfigPath)) {
    args.push('--mcp-config', mcpConfigPath);
  }

  // Resume session if available
  const prevCommand = db.select()
    .from(commands)
    .where(eq(commands.taskId, command.taskId))
    .all()
    .filter(c => c.sessionId && c.id !== commandId)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .pop();

  if (prevCommand?.sessionId) {
    args.push('--resume', prevCommand.sessionId);
  }

  // Build spawn environment with provider injection
  const PROVIDER_ENV_KEYS = [
    'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
  ];

  const spawnEnv = { ...process.env };
  let providerName: string | null = null;

  if (command.providerId) {
    const provider = db.select().from(providers).where(eq(providers.id, command.providerId)).get();
    if (provider) {
      providerName = provider.name;
      // Clear conflicting provider env vars
      for (const key of PROVIDER_ENV_KEYS) {
        delete spawnEnv[key];
      }
      // Inject profile env vars
      try {
        const envVars = JSON.parse(provider.envJson);
        Object.assign(spawnEnv, envVars);
      } catch {}
    }
  }

  // Record execution environment for audit (sanitized)
  const SENSITIVE_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;
  const execInfo = {
    args: args.filter(a => a !== command.prompt).concat(['[prompt omitted]']),
    env: Object.fromEntries(
      Object.entries(spawnEnv)
        .filter(([k]) => k.startsWith('ANTHROPIC_') || k.startsWith('CLAUDE_CODE_') || k.startsWith('AWS_'))
        .map(([k, v]) => [k, SENSITIVE_PATTERN.test(k) && v && v.length > 8
          ? v.slice(0, 8) + '••••'
          : v || ''
        ])
    ),
    cwd,
    providerName,
  };
  db.update(commands).set({ execEnv: JSON.stringify(execInfo) })
    .where(eq(commands.id, commandId)).run();

  // Spawn claude process
  const child = spawn('claude', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv,
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
  let allAssistantText: string[] = [];
  let permissionDenials: Array<{ tool_name: string; tool_input: Record<string, unknown> }> = [];

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
        // Accumulate all assistant text content blocks
        if (event.type === 'assistant' && event.message?.content) {
          const texts = (event.message.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text as string);
          allAssistantText.push(...texts);
        }
        if (event.type === 'result') {
          lastResult = event.result || '';
          sessionId = event.session_id || sessionId;
          console.log(`[claude-runner] cmd=${commandId} result event received, result_length=${lastResult.length}, permission_denials=${JSON.stringify(event.permission_denials?.length ?? 0)}`);
          if (event.permission_denials?.length) {
            permissionDenials = event.permission_denials;
            console.log(`[claude-runner] cmd=${commandId} permission_denials tools: ${event.permission_denials.map((d: { tool_name: string }) => d.tool_name).join(', ')}`);
          }
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

    console.log(`[claude-runner] cmd=${commandId} process closed, code=${code}, lastResult_length=${lastResult.length}, allAssistantText_count=${allAssistantText.length}, permissionDenials_count=${permissionDenials.length}`);

    const finalStatus = code === 0 ? 'completed' : 'failed';
    let result = code === 0
      ? (allAssistantText.length > 0 ? allAssistantText.join('\n\n') : lastResult || 'Command completed')
      : `Exit code: ${code}\n${stderr}`.trim();

    // Append AskUserQuestion permission denials as markdown
    const questionDenials = permissionDenials.filter(d => d.tool_name === 'AskUserQuestion');
    console.log(`[claude-runner] cmd=${commandId} questionDenials_count=${questionDenials.length}`);
    if (questionDenials.length > 0) {
      const parts: string[] = [];
      for (const denial of questionDenials) {
        const input = denial.tool_input as { questions?: Array<{ question: string; header?: string; options?: Array<{ label: string; description?: string }>; multiSelect?: boolean }> };
        if (!input.questions?.length) continue;
        for (const q of input.questions) {
          parts.push(`\n### ${q.header || '问题'}\n\n**${q.question}**${q.multiSelect ? '（可多选）' : ''}\n`);
          if (q.options?.length) {
            for (const opt of q.options) {
              parts.push(`- **${opt.label}**${opt.description ? ` — ${opt.description}` : ''}`);
            }
          }
        }
      }
      if (parts.length > 0) {
        result += '\n\n---\n\n> 以下问题需要你的回复：\n' + parts.join('\n');
      }
    }

    db.update(commands).set({
      status: finalStatus,
      result,
      sessionId: sessionId || null,
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();

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
