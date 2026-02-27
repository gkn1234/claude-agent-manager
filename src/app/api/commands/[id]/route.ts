import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['queued', 'aborted'],
  queued: ['running', 'pending', 'aborted'],
  running: ['completed', 'failed', 'aborted'],
  // completed, failed, aborted are terminal states - no transitions allowed
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!command) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(command);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!command) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updates = await req.json();

  if (updates.status) {
    const currentStatus = command.status || 'pending';
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(updates.status)) {
      return NextResponse.json(
        { error: `无法从 "${currentStatus}" 转换到 "${updates.status}"` },
        { status: 400 }
      );
    }
  }

  if (updates.status === 'aborted' && command.status === 'running' && command.pid) {
    try {
      process.kill(command.pid, 'SIGTERM');
      setTimeout(() => {
        try { process.kill(command.pid!, 'SIGKILL'); } catch {}
      }, 5000);
    } catch {}
  }

  const allowedUpdates: Record<string, unknown> = {};
  if (updates.status) allowedUpdates.status = updates.status;
  if (updates.priority !== undefined) allowedUpdates.priority = updates.priority;
  if (updates.status === 'aborted' || updates.status === 'failed') {
    allowedUpdates.finishedAt = new Date().toISOString();
  }

  db.update(commands).set(allowedUpdates).where(eq(commands.id, id)).run();
  const updated = db.select().from(commands).where(eq(commands.id, id)).get();
  return NextResponse.json(updated);
}
