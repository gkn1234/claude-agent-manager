import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects } from '@/lib/schema';
import { v4 as uuid } from 'uuid';
import { isGitRepo, gitClone, gitInit, getGitRemote, ensureGitignoreEntry } from '@/lib/utils/git';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_BASE_DIR = join(homedir(), 'claude-agent-manager');

function resolveProjectDir(name: string, workDir?: string): string {
  if (workDir) return workDir;
  return join(DEFAULT_BASE_DIR, name);
}

export async function GET() {
  const result = db.select().from(projects).all();
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, workDir, gitUrl, mode } = body;

  if (!name && mode !== 'local') {
    return NextResponse.json({ error: '项目名称不能为空' }, { status: 400 });
  }

  let finalDir: string;

  if (mode === 'clone') {
    if (!gitUrl) return NextResponse.json({ error: 'gitUrl required' }, { status: 400 });
    finalDir = resolveProjectDir(name, workDir);

    if (existsSync(finalDir)) {
      // 目录已存在：如果已经是目标仓库的 clone，直接复用
      if (isGitRepo(finalDir)) {
        const existingRemote = getGitRemote(finalDir);
        if (existingRemote === gitUrl.trim() || existingRemote === gitUrl.replace(/\.git$/, '').trim()) {
          // 同一仓库，直接复用目录
        } else {
          return NextResponse.json(
            { error: `目录 "${finalDir}" 已存在且是其他仓库` },
            { status: 409 }
          );
        }
      } else {
        return NextResponse.json(
          { error: `目录 "${finalDir}" 已存在且不是 Git 仓库` },
          { status: 409 }
        );
      }
    } else {
      gitClone(gitUrl, finalDir);
    }
  } else if (mode === 'new') {
    finalDir = resolveProjectDir(name, workDir);

    if (existsSync(finalDir)) {
      return NextResponse.json(
        { error: `目录 "${finalDir}" 已存在，请更换项目名称` },
        { status: 409 }
      );
    }

    mkdirSync(finalDir, { recursive: true });
    gitInit(finalDir);
  } else {
    // local mode
    finalDir = workDir;
    if (!finalDir || !existsSync(finalDir)) {
      return NextResponse.json({ error: '目录不存在' }, { status: 400 });
    }
    if (!isGitRepo(finalDir)) {
      return NextResponse.json({ error: '目录不是 Git 仓库' }, { status: 400 });
    }
  }

  ensureGitignoreEntry(finalDir, '.worktrees/');

  const id = uuid();
  const gitRemote = getGitRemote(finalDir);

  db.insert(projects).values({ id, name: name || finalDir.split('/').pop() || 'unnamed', workDir: finalDir, gitRemote }).run();

  return NextResponse.json({ id, name, workDir: finalDir, gitRemote }, { status: 201 });
}
