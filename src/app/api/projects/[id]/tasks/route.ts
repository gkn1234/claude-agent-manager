import { NextResponse } from 'next/server';
import { createTask } from '@/lib/tasks';

const ERROR_STATUS: Record<string, number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  internal: 500,
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const { description, branch, baseBranch } = await req.json();

  const result = createTask({ projectId, description, branch, baseBranch });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.code] ?? 500 });
  }

  return NextResponse.json(result.task, { status: 201 });
}
