import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { v4 as uuid } from 'uuid';
import { isGitRepo, gitClone, gitInit, getGitRemote, ensureGitignoreEntry } from '@/lib/utils/git';
import { existsSync, mkdirSync } from 'fs';

export async function GET() {
  const result = db.select().from(projects).all();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, workDir, gitUrl, mode } = body;

  let finalDir = workDir;

  if (mode === 'clone') {
    if (!gitUrl) return NextResponse.json({ error: 'gitUrl required' }, { status: 400 });
    finalDir = workDir || `/home/projects/${name}`;
    gitClone(gitUrl, finalDir);
  } else if (mode === 'new') {
    finalDir = workDir || `/home/projects/${name}`;
    if (!existsSync(finalDir)) mkdirSync(finalDir, { recursive: true });
    gitInit(finalDir);
  } else {
    if (!finalDir || !existsSync(finalDir)) {
      return NextResponse.json({ error: 'workDir does not exist' }, { status: 400 });
    }
    if (!isGitRepo(finalDir)) {
      return NextResponse.json({ error: 'Not a git repository' }, { status: 400 });
    }
  }

  ensureGitignoreEntry(finalDir, '.worktrees/');

  const id = uuid();
  const gitRemote = getGitRemote(finalDir);

  db.insert(projects).values({ id, name, workDir: finalDir, gitRemote }).run();

  return NextResponse.json({ id, name, workDir: finalDir, gitRemote }, { status: 201 });
}
