import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('project_id');

  let result;
  if (projectId) {
    result = db.select().from(tasks).where(eq(tasks.projectId, projectId)).all();
  } else {
    result = db.select().from(tasks).all();
  }
  return NextResponse.json(result);
}
