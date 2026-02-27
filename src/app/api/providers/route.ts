import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { providers } from '@/lib/schema';
import { eq, asc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function GET() {
  try {
    const rows = db.select().from(providers).orderBy(asc(providers.sortOrder)).all();
    const result = rows.map(r => ({
      ...r,
      envJson: (() => { try { return JSON.parse(r.envJson); } catch { return {}; } })(),
    }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { name, envJson } = await req.json();
    if (!name || !envJson) {
      return NextResponse.json({ error: '名称和环境变量不能为空' }, { status: 400 });
    }

    // New provider gets next sortOrder
    const maxRow = db.select().from(providers).orderBy(asc(providers.sortOrder)).all();
    const nextOrder = maxRow.length > 0 ? Math.max(...maxRow.map(r => r.sortOrder ?? 0)) + 1 : 0;

    const id = uuid();
    db.insert(providers).values({
      id,
      name,
      envJson: typeof envJson === 'string' ? envJson : JSON.stringify(envJson),
      sortOrder: nextOrder,
    }).run();

    const created = db.select().from(providers).where(
      eq(providers.id, id)
    ).get();

    return NextResponse.json({
      ...created,
      envJson: created ? (() => { try { return JSON.parse(created.envJson); } catch { return {}; } })() : {},
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
