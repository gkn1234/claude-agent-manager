import { NextResponse } from 'next/server';
import { runningProcesses } from '@/lib/claude-runner';
import { ensureInitialized } from '@/lib/init';

export async function GET() {
  ensureInitialized();

  const maxConcurrent = parseInt(process.env.MAX_CONCURRENT || '2');

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
