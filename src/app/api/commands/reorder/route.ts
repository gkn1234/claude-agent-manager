import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(req: Request) {
  const { items } = await req.json();

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  for (const item of items) {
    db.update(commands)
      .set({ priority: item.priority })
      .where(eq(commands.id, item.id))
      .run();
  }

  return NextResponse.json({ ok: true });
}
