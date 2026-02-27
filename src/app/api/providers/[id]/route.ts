import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { providers } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const existing = db.select().from(providers).where(eq(providers.id, id)).get();
    if (!existing) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.envJson !== undefined) {
      updates.envJson = typeof body.envJson === 'string' ? body.envJson : JSON.stringify(body.envJson);
    }

    db.update(providers).set(updates).where(eq(providers.id, id)).run();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    db.delete(providers).where(eq(providers.id, id)).run();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
