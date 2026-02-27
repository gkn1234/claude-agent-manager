# Claude Code 远程任务派发系统 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个移动端优先的 Web 应用，支持远程向 ECS 上的 Claude Code 派发任务并监控状态。

**Architecture:** Next.js 全栈应用，前端 React + shadcn + Tailwind，后端 API Routes + SQLite (drizzle-orm)。Claude Code 通过 child_process.spawn 管理，stream-json 输出存文件，状态存 SQLite，前端通过 SSE 获取实时更新。MCP Server 内嵌于 Next.js，供 Claude Code 调用系统 API。

**Tech Stack:** Next.js 15 (App Router, TypeScript), drizzle-orm + better-sqlite3, shadcn/ui + Tailwind CSS, SSE (ReadableStream)

**Design Doc:** `docs/plans/2026-02-27-task-dispatch-system-design.md`

---

## Phase 1: 项目脚手架与数据库

### Task 1: 初始化 Next.js 项目

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/page.tsx`

**Step 1: 创建 Next.js 项目**

```bash
cd /Users/macbookair/Desktop/projects/claude-agent-manager
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes
```

注意：项目目录已存在 `docs/` 和 `.git`，create-next-app 会在现有目录中初始化。如果报错，使用 `--yes` 跳过确认，或先将 docs 临时移出。

**Step 2: 验证项目可运行**

```bash
npm run dev
# 访问 http://localhost:3000 确认页面正常
# Ctrl+C 停止
```

**Step 3: 安装核心依赖**

```bash
npm install drizzle-orm better-sqlite3 uuid
npm install -D drizzle-kit @types/better-sqlite3 @types/uuid
```

**Step 4: 初始化 shadcn/ui**

```bash
npx shadcn@latest init
# 选择 Default style, Neutral color, CSS variables: yes
```

**Step 5: 安装常用 shadcn 组件**

```bash
npx shadcn@latest add button card dialog input textarea badge separator scroll-area tabs
```

**Step 6: 更新 .gitignore**

在 `.gitignore` 中添加：

```
# SQLite
*.db
*.db-journal
*.db-wal

# Claude logs
logs/

# Worktrees
.worktrees/
```

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: initialize Next.js project with shadcn/ui and dependencies"
```

---

### Task 2: 数据库 Schema 与连接

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/schema.ts`
- Create: `drizzle.config.ts`

**Step 1: 创建 drizzle 配置**

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/dispatch.db',
  },
});
```

**Step 2: 定义 Schema**

```ts
// src/lib/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  workDir: text('work_dir').notNull(),
  gitRemote: text('git_remote'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  description: text('description').notNull(),
  branch: text('branch'),
  worktreeDir: text('worktree_dir'),
  status: text('status').default('initializing'), // initializing / ready / archived
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const commands = sqliteTable('commands', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  prompt: text('prompt').notNull(),
  mode: text('mode').default('execute'), // plan / execute
  status: text('status').default('pending'), // pending / queued / running / completed / failed / aborted
  priority: integer('priority').default(0),
  result: text('result'),
  logFile: text('log_file'),
  sessionId: text('session_id'),
  pid: integer('pid'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});
```

**Step 3: 创建数据库连接**

```ts
// src/lib/db.ts
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || './data/dispatch.db';

// Ensure data directory exists
const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
```

**Step 4: 生成并运行迁移**

```bash
mkdir -p data
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Step 5: 验证数据库**

```bash
npx drizzle-kit studio
# 打开 Drizzle Studio 确认三张表已创建
# Ctrl+C 停止
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add database schema and drizzle-orm setup"
```

---

## Phase 2: 后端 API — 项目管理

### Task 3: Projects CRUD API

**Files:**
- Create: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/[id]/route.ts`
- Create: `src/lib/utils/git.ts`

**Step 1: 创建 git 工具函数**

```ts
// src/lib/utils/git.ts
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export function isGitRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}

export function getGitRemote(dir: string): string | null {
  try {
    const remote = execSync('git remote get-url origin', { cwd: dir, encoding: 'utf-8' }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

export function gitClone(url: string, targetDir: string): void {
  execSync(`git clone ${url} ${targetDir}`, { encoding: 'utf-8' });
}

export function gitInit(dir: string): void {
  execSync('git init', { cwd: dir, encoding: 'utf-8' });
}

export function ensureGitignoreEntry(dir: string, entry: string): void {
  const gitignorePath = join(dir, '.gitignore');
  const fs = require('fs');
  let content = '';
  if (existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf-8');
  }
  if (!content.includes(entry)) {
    fs.appendFileSync(gitignorePath, `\n${entry}\n`);
  }
}
```

**Step 2: 创建 Projects 列表/创建 API**

```ts
// src/app/api/projects/route.ts
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
  // mode: 'local' | 'clone' | 'new'

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
    // local
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
  const project = db.select().from(projects).where(({ id: col }) => col.equals(id)).get();

  return NextResponse.json({ id, name, workDir: finalDir, gitRemote }, { status: 201 });
}
```

**Step 3: 创建 Project 详情/删除 API**

```ts
// src/app/api/projects/[id]/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { execSync } from 'child_process';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, id)).all();
  return NextResponse.json({ ...project, tasks: projectTasks });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Delete associated commands and tasks first
  const projectTasks = db.select().from(tasks).where(eq(tasks.projectId, id)).all();
  for (const task of projectTasks) {
    db.delete(commands).where(eq(commands.taskId, task.id)).run();
  }
  db.delete(tasks).where(eq(tasks.projectId, id)).run();
  db.delete(projects).where(eq(projects.id, id)).run();

  // Optionally remove work directory (dangerous!)
  // Only if explicitly requested via query param ?removeDir=true
  // Not implemented by default for safety

  return NextResponse.json({ ok: true });
}
```

**Step 4: 手动测试 API**

```bash
npm run dev &

# 创建项目（新建模式）
curl -X POST http://localhost:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"test-project","mode":"new","workDir":"/tmp/test-dispatch-project"}'

# 列表
curl http://localhost:3000/api/projects

# 停止 dev server
kill %1
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add projects CRUD API with git integration"
```

---

### Task 4: Tasks CRUD API

**Files:**
- Create: `src/app/api/projects/[id]/tasks/route.ts`
- Create: `src/app/api/tasks/route.ts`
- Create: `src/app/api/tasks/[id]/route.ts`

**Step 1: 创建任务（含自动初始化指令）**

```ts
// src/app/api/projects/[id]/tasks/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands, projects } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { description } = await req.json();
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 });

  const taskId = uuid();
  db.insert(tasks).values({
    id: taskId,
    projectId,
    description,
    status: 'initializing',
  }).run();

  // Auto-create initialization command
  const commandId = uuid();
  const initPrompt = `你正在一个任务派发系统中工作。请基于以下任务描述完成初始化：

1. 在项目工作目录 ${project.workDir} 下的 .worktrees/ 目录中创建 git worktree 作为本任务的工作空间
2. 分支命名格式：task/${taskId.slice(0, 8)}
3. 理解项目结构
4. 如果任务过于庞大，请通过 MCP create_task 工具拆分为多个子任务

任务描述：${description}`;

  db.insert(commands).values({
    id: commandId,
    taskId,
    prompt: initPrompt,
    mode: 'execute',
    status: 'queued',
    priority: 10, // Initialization gets high priority
  }).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  return NextResponse.json(task, { status: 201 });
}
```

**Step 2: 任务列表 API**

```ts
// src/app/api/tasks/route.ts
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
```

**Step 3: 任务详情/删除 API**

```ts
// src/app/api/tasks/[id]/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const taskCommands = db.select().from(commands).where(eq(commands.taskId, id)).all();
  return NextResponse.json({ ...task, commands: taskCommands });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Clean up worktree if it exists
  if (task.worktreeDir && existsSync(task.worktreeDir)) {
    try {
      execSync(`git worktree remove "${task.worktreeDir}" --force`, { encoding: 'utf-8' });
    } catch {
      // Force remove directory if git worktree remove fails
    }
  }

  db.delete(commands).where(eq(commands.taskId, id)).run();
  db.delete(tasks).where(eq(tasks.id, id)).run();

  return NextResponse.json({ ok: true });
}
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add tasks CRUD API with auto-initialization command"
```

---

### Task 5: Commands CRUD API

**Files:**
- Create: `src/app/api/tasks/[id]/commands/route.ts`
- Create: `src/app/api/commands/route.ts`
- Create: `src/app/api/commands/[id]/route.ts`
- Create: `src/app/api/commands/[id]/logs/route.ts`
- Create: `src/app/api/commands/reorder/route.ts`

**Step 1: 创建指令 API**

```ts
// src/app/api/tasks/[id]/commands/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, commands } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: taskId } = await params;
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Check if task has a running command
  const running = db.select().from(commands)
    .where(and(eq(commands.taskId, taskId), eq(commands.status, 'running')))
    .get();
  if (running) {
    return NextResponse.json({ error: 'Task has a running command' }, { status: 409 });
  }

  const { prompt, mode = 'execute', autoQueue = true } = await req.json();
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 });

  const id = uuid();
  db.insert(commands).values({
    id,
    taskId,
    prompt,
    mode,
    status: autoQueue ? 'queued' : 'pending',
  }).run();

  const command = db.select().from(commands).where(eq(commands.id, id)).get();
  return NextResponse.json(command, { status: 201 });
}
```

**Step 2: 全局指令列表 API**

```ts
// src/app/api/commands/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands, tasks, projects } from '@/lib/schema';
import { desc, asc, eq, sql } from 'drizzle-orm';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const projectId = searchParams.get('project_id');
  const taskId = searchParams.get('task_id');

  // Join commands with tasks and projects for display
  let query = db.select({
    id: commands.id,
    taskId: commands.taskId,
    prompt: commands.prompt,
    mode: commands.mode,
    status: commands.status,
    priority: commands.priority,
    result: commands.result,
    startedAt: commands.startedAt,
    finishedAt: commands.finishedAt,
    createdAt: commands.createdAt,
    taskDescription: tasks.description,
    projectId: tasks.projectId,
    projectName: projects.name,
  })
  .from(commands)
  .innerJoin(tasks, eq(commands.taskId, tasks.id))
  .innerJoin(projects, eq(tasks.projectId, projects.id))
  .orderBy(desc(commands.priority), asc(commands.createdAt));

  const result = query.all();

  // Filter in JS for simplicity (small dataset for single user)
  let filtered = result;
  if (status) filtered = filtered.filter(c => c.status === status);
  if (projectId) filtered = filtered.filter(c => c.projectId === projectId);
  if (taskId) filtered = filtered.filter(c => c.taskId === taskId);

  return NextResponse.json(filtered);
}
```

**Step 3: 指令详情/更新/中止 API**

```ts
// src/app/api/commands/[id]/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';

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

  // Handle abort
  if (updates.status === 'aborted' && command.status === 'running' && command.pid) {
    try {
      process.kill(command.pid, 'SIGTERM');
      // Give 5 seconds to gracefully shutdown
      setTimeout(() => {
        try { process.kill(command.pid!, 'SIGKILL'); } catch {}
      }, 5000);
    } catch {
      // Process may already be dead
    }
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
```

**Step 4: 日志懒加载 API**

```ts
// src/app/api/commands/[id]/logs/route.ts
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
```

**Step 5: 批量调整优先级 API**

```ts
// src/app/api/commands/reorder/route.ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function PATCH(req: Request) {
  const { items } = await req.json();
  // items: [{ id: string, priority: number }]

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
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add commands CRUD API with abort and reorder"
```

---

## Phase 3: Claude 进程调度器

### Task 6: 调度器与进程管理

**Files:**
- Create: `src/lib/scheduler.ts`
- Create: `src/lib/claude-runner.ts`
- Create: `src/app/api/system/status/route.ts`
- Create: `src/app/api/events/route.ts`

**Step 1: 创建 Claude 运行器**

```ts
// src/lib/claude-runner.ts
import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { db } from './db';
import { commands, tasks } from './schema';
import { eq } from 'drizzle-orm';

const LOG_DIR = process.env.LOG_DIR || './logs';

export interface RunningProcess {
  pid: number;
  commandId: string;
  process: ChildProcess;
}

// Global process map
export const runningProcesses = new Map<string, RunningProcess>();

export async function runCommand(commandId: string): Promise<void> {
  const command = db.select().from(commands).where(eq(commands.id, commandId)).get();
  if (!command) throw new Error('Command not found');

  const task = db.select().from(tasks).where(eq(tasks.id, command.taskId)).get();
  if (!task) throw new Error('Task not found');

  // Determine working directory
  const cwd = task.worktreeDir || task.worktreeDir; // Use project workDir as fallback during init
  // For initialization, we need the project work dir
  // We'll get it via a join
  const taskWithProject = db.query.tasks.findFirst({
    where: eq(tasks.id, command.taskId),
    with: { project: true },
  });

  // Ensure log directory
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${commandId}.ndjson`);
  const logStream = createWriteStream(logFile, { flags: 'a' });

  // Build claude command args
  const args = [
    '-p', command.prompt,
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
  ];

  // Resume session if available (same task's previous session)
  if (command.sessionId) {
    args.push('--resume', command.sessionId);
  } else {
    // Find latest session from previous commands in same task
    const prevCommand = db.select()
      .from(commands)
      .where(eq(commands.taskId, command.taskId))
      .orderBy(commands.createdAt)
      .all()
      .filter(c => c.sessionId && c.id !== commandId)
      .pop();

    if (prevCommand?.sessionId) {
      args.push('--resume', prevCommand.sessionId);
    }
  }

  // Spawn claude process
  const child = spawn('claude', args, {
    cwd: task.worktreeDir || undefined,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  if (!child.pid) {
    db.update(commands).set({
      status: 'failed',
      result: 'Failed to spawn claude process',
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();
    return;
  }

  // Update command with PID and status
  db.update(commands).set({
    status: 'running',
    pid: child.pid,
    logFile,
    startedAt: new Date().toISOString(),
  }).where(eq(commands.id, commandId)).run();

  runningProcesses.set(commandId, { pid: child.pid, commandId, process: child });

  let lastResult = '';
  let sessionId = '';
  let stderr = '';

  // Parse stream-json output
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      logStream.write(line + '\n');

      try {
        const event = JSON.parse(line);
        // Capture session_id
        if (event.session_id && !sessionId) {
          sessionId = event.session_id;
        }
        // Capture final result (last assistant message)
        if (event.type === 'result') {
          lastResult = event.result || '';
          sessionId = event.session_id || sessionId;
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    logStream.end();
    runningProcesses.delete(commandId);

    const status = code === 0 ? 'completed' : 'failed';
    const result = code === 0
      ? lastResult || 'Command completed'
      : `Exit code: ${code}\n${stderr}`.trim();

    db.update(commands).set({
      status,
      result,
      sessionId: sessionId || undefined,
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();

    // If this was an init command and it succeeded, update task status
    if (code === 0) {
      const cmd = db.select().from(commands).where(eq(commands.id, commandId)).get();
      if (cmd && cmd.prompt.includes('创建 git worktree')) {
        db.update(tasks).set({ status: 'ready' }).where(eq(tasks.id, cmd.taskId)).run();
      }
    }
  });

  child.on('error', (err) => {
    logStream.end();
    runningProcesses.delete(commandId);
    db.update(commands).set({
      status: 'failed',
      result: `Process error: ${err.message}`,
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, commandId)).run();
  });

  // Timeout handler
  const timeout = parseInt(process.env.COMMAND_TIMEOUT || '1800') * 1000;
  setTimeout(() => {
    if (runningProcesses.has(commandId)) {
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    }
  }, timeout);
}
```

**Step 2: 创建调度器**

```ts
// src/lib/scheduler.ts
import { db } from './db';
import { commands } from './schema';
import { eq, and, desc, asc, sql, or } from 'drizzle-orm';
import { runCommand, runningProcesses } from './claude-runner';

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '2');
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5') * 1000;

let schedulerTimer: NodeJS.Timeout | null = null;

export function startScheduler() {
  if (schedulerTimer) return;

  // Recover from crash: mark orphaned running commands as failed
  recoverOrphanedCommands();

  schedulerTimer = setInterval(tick, POLL_INTERVAL);
  console.log(`[Scheduler] Started, max_concurrent=${MAX_CONCURRENT}, poll_interval=${POLL_INTERVAL}ms`);

  // Run immediately
  tick();
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

function tick() {
  const runningCount = runningProcesses.size;

  if (runningCount >= MAX_CONCURRENT) return;

  const slotsAvailable = MAX_CONCURRENT - runningCount;

  // Get next queued commands by priority (desc) then created_at (asc)
  const queued = db.select()
    .from(commands)
    .where(or(eq(commands.status, 'queued'), eq(commands.status, 'pending')))
    .orderBy(desc(commands.priority), asc(commands.createdAt))
    .limit(slotsAvailable)
    .all()
    .filter(c => c.status === 'queued'); // Only auto-run queued, not pending

  for (const cmd of queued) {
    // Check task doesn't already have a running command
    const taskRunning = db.select()
      .from(commands)
      .where(and(eq(commands.taskId, cmd.taskId), eq(commands.status, 'running')))
      .get();

    if (taskRunning) continue;

    runCommand(cmd.id).catch(err => {
      console.error(`[Scheduler] Failed to run command ${cmd.id}:`, err);
    });
  }
}

function recoverOrphanedCommands() {
  const orphaned = db.select()
    .from(commands)
    .where(eq(commands.status, 'running'))
    .all();

  for (const cmd of orphaned) {
    if (cmd.pid) {
      try {
        // Check if process is still alive
        process.kill(cmd.pid, 0);
        // If it's alive, kill it (stale from previous run)
        process.kill(cmd.pid, 'SIGTERM');
      } catch {
        // Process is dead
      }
    }

    db.update(commands).set({
      status: 'failed',
      result: '服务重启导致中断',
      pid: null,
      finishedAt: new Date().toISOString(),
    }).where(eq(commands.id, cmd.id)).run();
  }
}
```

**Step 3: 在应用启动时初始化调度器**

在 `src/lib/db.ts` 末尾或创建单独的初始化模块：

```ts
// src/lib/init.ts
import { startScheduler } from './scheduler';

let initialized = false;

export function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  startScheduler();
}
```

在 API route 中确保调度器启动（例如在 `src/app/api/system/status/route.ts` 中）。

**Step 4: 系统状态 API**

```ts
// src/app/api/system/status/route.ts
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
```

**Step 5: SSE 事件流**

```ts
// src/app/api/events/route.ts
import { db } from '@/lib/db';
import { commands } from '@/lib/schema';
import { ensureInitialized } from '@/lib/init';

export async function GET(req: Request) {
  ensureInitialized();

  const encoder = new TextEncoder();
  let lastSnapshot = '';

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may be closed
        }
      };

      const interval = setInterval(() => {
        // Send current state of non-completed commands
        const active = db.select().from(commands).all()
          .filter(c => ['queued', 'running', 'pending'].includes(c.status || ''));

        const snapshot = JSON.stringify(active.map(c => ({ id: c.id, status: c.status })));
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          send({ type: 'commands_update', commands: active });
        }
      }, 2000);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add claude process scheduler and SSE events"
```

---

## Phase 4: 前端 UI

### Task 7: 全局布局与导航

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/globals.css` (modify)
- Create: `src/components/nav/bottom-tabs.tsx`
- Create: `src/components/nav/sidebar.tsx`
- Create: `src/hooks/use-media-query.ts`

**Step 1: 创建响应式导航组件**

创建底部 Tab Bar（移动端）和侧边栏（桌面端），三个 Tab：首页、项目、设置。使用 `useMediaQuery` 判断设备类型。

**Step 2: 更新根布局**

`src/app/layout.tsx` 包裹导航组件，设置 viewport meta 确保移动端体验。

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add responsive navigation with bottom tabs and sidebar"
```

---

### Task 8: 首页 — 指令队列

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/commands/command-card.tsx`
- Create: `src/components/commands/command-list.tsx`
- Create: `src/components/commands/status-group.tsx`
- Create: `src/hooks/use-commands.ts`
- Create: `src/hooks/use-sse.ts`

**Step 1: 创建 SSE Hook**

```ts
// src/hooks/use-sse.ts
// 订阅 /api/events，解析 SSE 数据，触发 React 状态更新
```

**Step 2: 创建 useCommands Hook**

```ts
// src/hooks/use-commands.ts
// 获取全局指令列表，支持 SSE 实时更新
// 提供 reorder, abort 等操作方法
```

**Step 3: 创建指令卡片组件**

`CommandCard` 显示：项目/任务名、prompt 摘要（截断）、状态 Badge、时间。点击进入指令详情。

**Step 4: 创建状态分组组件**

`StatusGroup` 按状态分组（进行中/排队中/已完成），可折叠。排队中支持长按拖拽。

**Step 5: 创建首页**

组合 `StatusGroup` + `CommandCard`，添加项目/任务过滤器下拉菜单。过滤后禁用拖拽。

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: add home page with command queue and drag reorder"
```

---

### Task 9: 项目管理页面

**Files:**
- Create: `src/app/projects/page.tsx`
- Create: `src/app/projects/[id]/page.tsx`
- Create: `src/components/projects/project-card.tsx`
- Create: `src/components/projects/create-project-dialog.tsx`

**Step 1: 项目列表页**

卡片列表展示项目，每个卡片显示名称、工作目录、任务数。右上角"新建"按钮。

**Step 2: 创建项目弹窗**

Dialog 表单，支持三种模式选择（本地/clone/新建），动态表单字段。

**Step 3: 项目详情页**

展示项目信息 + 任务列表，"新建任务"按钮。

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add project management pages"
```

---

### Task 10: 任务视图与指令详情

**Files:**
- Create: `src/app/tasks/[id]/page.tsx`
- Create: `src/app/commands/[id]/page.tsx`
- Create: `src/components/tasks/command-timeline.tsx`
- Create: `src/components/tasks/command-input.tsx`
- Create: `src/components/commands/result-viewer.tsx`
- Create: `src/components/commands/log-viewer.tsx`

**Step 1: 任务视图**

- 顶部：任务元信息（描述、分支、状态）
- 中间：历史指令时间线（纵向排列）
- 底部固定：输入框 + 模式选择（plan/execute）+ 发送按钮
- 有进行中指令时输入框禁用

**Step 2: 指令详情页**

- 状态 + 基本信息
- 结果展示（markdown 渲染）
- 失败时自动展示最后几行日志
- "查看完整日志"按钮，懒加载 `/api/commands/:id/logs`

**Step 3: Markdown 渲染**

安装 `react-markdown` + `rehype-highlight` 用于结果展示。

```bash
npm install react-markdown rehype-highlight
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add task view and command detail pages"
```

---

### Task 11: 设置页面

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/api/system/config/route.ts`

**Step 1: 系统配置 API**

配置存 SQLite（新建 `config` 表或使用 JSON 文件），支持 GET/PATCH。

配置项：`max_concurrent`, `command_timeout`, `log_retention_days`, `poll_interval`

**Step 2: 设置页面 UI**

表单展示和编辑配置项，保存时调用 API。

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add settings page and system config API"
```

---

## Phase 5: MCP Server

### Task 12: MCP Server 集成

**Files:**
- Create: `src/lib/mcp-server.ts`
- Create: `src/app/api/mcp/route.ts`

**Step 1: 实现 MCP Server**

使用 `@modelcontextprotocol/sdk` 实现 HTTP MCP Server，提供以下 Tools：

- `create_task(projectId, description)` — 创建子任务
- `update_command(commandId, status)` — 更新指令状态
- `get_task_context(taskId)` — 获取任务上下文
- `list_tasks(projectId)` — 列出任务

```bash
npm install @modelcontextprotocol/sdk
```

**Step 2: 挂载 MCP 路由**

将 MCP Server 挂载到 `/api/mcp` 路由，Claude Code 通过 `--mcp-config` 指定此 endpoint。

**Step 3: 更新 claude-runner 的 spawn 参数**

在 spawn claude 时注入 MCP 配置：

```ts
args.push('--mcp-config', mcpConfigPath);
```

MCP 配置文件指向 `http://localhost:3000/api/mcp`。

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add MCP server for Claude Code integration"
```

---

## Phase 6: 集成测试与收尾

### Task 13: 端到端集成测试

**Step 1: 启动完整系统**

```bash
npm run dev
```

**Step 2: 测试完整流程**

1. 创建项目（本地模式，指向一个已有 git 仓）
2. 创建任务（验证初始化指令自动入队）
3. 观察调度器自动执行初始化指令
4. 在初始化完成的任务中派发新指令
5. 中止一个进行中的指令
6. 验证首页队列的状态更新和拖拽排序
7. 手机浏览器访问测试移动端体验

**Step 3: 修复发现的问题**

**Step 4: Commit**

```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

### Task 14: 生产部署配置

**Files:**
- Create: `Dockerfile` (可选)
- Create: `.env.example`

**Step 1: 环境变量配置**

```env
# .env.example
DB_PATH=./data/dispatch.db
LOG_DIR=./logs
MAX_CONCURRENT=2
COMMAND_TIMEOUT=1800
POLL_INTERVAL=5
PORT=3000
```

**Step 2: 构建验证**

```bash
npm run build
npm start
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: add production deployment configuration"
```
