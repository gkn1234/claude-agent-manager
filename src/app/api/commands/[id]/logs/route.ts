import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  if (!command) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!command.logFile || !existsSync(command.logFile)) {
    return NextResponse.json({ logs: null, message: 'No log file available' });
  }

  const content = readFileSync(command.logFile, 'utf-8');
  return NextResponse.json({ logs: content });
}
