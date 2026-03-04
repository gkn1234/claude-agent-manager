import { db } from './db';
import { commands } from './schema';
import { eq, and, asc, desc } from 'drizzle-orm';
import { runCommand, runningProcesses } from './claude-runner';
import { getConfig } from '@/lib/config';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let currentPollInterval = 0;

export function startScheduler() {
  if (schedulerTimer) return;

  recoverOrphanedCommands();

  currentPollInterval = parseInt(getConfig('poll_interval', '5')) * 1000;
  schedulerTimer = setInterval(tick, currentPollInterval);
  console.log(`[Scheduler] Started, poll_interval=${currentPollInterval}ms`);

  tick();
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function tick() {
  // Detect poll_interval changes at runtime
  const newPollInterval = parseInt(getConfig('poll_interval', '5')) * 1000;
  if (newPollInterval !== currentPollInterval && schedulerTimer) {
    clearInterval(schedulerTimer);
    currentPollInterval = newPollInterval;
    schedulerTimer = setInterval(tick, currentPollInterval);
    console.log(`[Scheduler] poll_interval changed to ${currentPollInterval}ms`);
  }

  const maxConcurrent = parseInt(getConfig('max_concurrent', '2'));
  const runningCount = runningProcesses.size;
  if (runningCount >= maxConcurrent) return;

  const slotsAvailable = maxConcurrent - runningCount;

  const queued = db.select()
    .from(commands)
    .where(eq(commands.status, 'queued'))
    .orderBy(desc(commands.priority), asc(commands.createdAt))
    .limit(slotsAvailable)
    .all();

  for (const cmd of queued) {
    const taskRunning = db.select()
      .from(commands)
      .where(and(eq(commands.taskId, cmd.taskId), eq(commands.status, 'running')))
      .get();

    if (taskRunning) continue;

    runCommand(cmd.id).catch(err => {
      console.error(`[Scheduler] Failed to run command ${cmd.id}:`, err);
    });
  }
}

function recoverOrphanedCommands() {
  const orphaned = db.select()
    .from(commands)
    .where(eq(commands.status, 'running'))
    .all();

  for (const cmd of orphaned) {
    if (cmd.pid) {
      try {
        process.kill(cmd.pid, 0);
        process.kill(cmd.pid, 'SIGTERM');
      } catch {}
    }

    db.update(commands).set({
      status: 'failed',
      result: '服务重启导致中断',
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, cmd.id)).run();
  }

  if (orphaned.length > 0) {
    console.log(`[Scheduler] Recovered ${orphaned.length} orphaned command(s)`);
  }
}
