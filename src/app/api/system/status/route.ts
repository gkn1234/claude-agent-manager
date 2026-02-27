import { NextResponse } from 'next/server';
import { runningProcesses } from '@/lib/claude-runner';
import { ensureInitialized } from '@/lib/init';
import { getConfig } from '@/lib/config';

export async function GET() {
  ensureInitialized();

  const maxConcurrent = parseInt(getConfig('max_concurrent', '2'));

  return NextResponse.json({
    running: runningProcesses.size,
    maxConcurrent,
    available: maxConcurrent - runningProcesses.size,
    processes: Array.from(runningProcesses.entries()).map(([id, p]) => ({
      commandId: id,
      pid: p.pid,
    })),
  });
}
