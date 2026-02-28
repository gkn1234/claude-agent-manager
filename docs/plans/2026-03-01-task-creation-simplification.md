# 任务创建简化 + 分支名绑定 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 简化任务生命周期，去掉自动初始化流程（init/research），任务创建即原子地完成 worktree 和分支创建。

**Architecture:** 任务从多态状态机（pending/initializing/researching/ready）简化为单态（创建即可用）。创建任务时原子地创建 git 分支和 worktree，失败则不创建任务。分支名 = worktree 目录名，仅允许 `[a-z0-9-]`。

**Tech Stack:** Next.js 16、Drizzle ORM + SQLite、TypeScript、shadcn/ui、git CLI

---

### Task 1: Schema — 删除 status 字段，branch 改为 not null

**Files:**
- Modify: `src/lib/schema.ts:14-25`

**Step 1: 修改 schema**

将 tasks 表的 `status` 字段删除，`branch` 改为 `notNull()`，`worktreeDir` 保留。字段 `description` 重命名语义为任务名称（保留字段名不变，后续 UI 用 name 标签）。

```typescript
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  description: text('description').notNull(),
  branch: text('branch').notNull(),
  worktreeDir: text('worktree_dir'),
  lastProviderId: text('last_provider_id'),
  lastMode: text('last_mode'),
  createdAt: text('created_at').default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  updatedAt: text('updated_at').default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});
```

**Step 2: 运行构建验证**

Run: `cd /Users/macbookair/Desktop/projects/claude-agent-manager && npx tsc --noEmit 2>&1 | head -50`
Expected: 多处类型错误（引用了已删除的 status），后续 task 逐一修复。

**Step 3: 提交**

```bash
git add src/lib/schema.ts
git commit -m "refactor: remove task status field, make branch required"
```

---

### Task 2: Config — 删除 init_prompt/research_prompt

**Files:**
- Modify: `src/lib/config.ts:5-32`
- Modify: `src/app/settings/page.tsx:39-46`
- Modify: `src/app/api/system/config/route.ts`（无需修改，CONFIG_KEYS 自动跟随）

**Step 1: 从 CONFIG_DEFAULTS 删除 init_prompt 和 research_prompt**

`src/lib/config.ts` — 删除 `research_prompt` 和 `init_prompt` 两个键及其值，只保留 4 个数字配置。

```typescript
const CONFIG_DEFAULTS: Record<string, string> = {
  max_concurrent: '2',
  command_timeout: '1800',
  log_retention_days: '30',
  poll_interval: '5',
};
```

**Step 2: 从设置页删除对应 UI**

`src/app/settings/page.tsx` — CONFIG_ITEMS 数组中删除 `init_prompt` 和 `research_prompt` 两项：

```typescript
const CONFIG_ITEMS: ConfigItem[] = [
  { key: 'max_concurrent', label: '最大并发数', description: '同时运行的 Claude 实例最大数量', unit: '个', type: 'number' },
  { key: 'command_timeout', label: '指令超时时间', description: '单条指令的最大执行时间', unit: '秒', type: 'number' },
  { key: 'log_retention_days', label: '日志保留天数', description: '日志文件自动清理的保留天数', unit: '天', type: 'number' },
  { key: 'poll_interval', label: '轮询间隔', description: '调度器检查待执行指令的间隔', unit: '秒', type: 'number' },
];
```

**Step 3: 提交**

```bash
git add src/lib/config.ts src/app/settings/page.tsx
git commit -m "refactor: remove init_prompt and research_prompt config keys"
```

---

### Task 3: 删除 init 路由

**Files:**
- Delete: `src/app/api/tasks/[id]/init/route.ts`（整个文件）

**Step 1: 删除文件**

```bash
rm src/app/api/tasks/[id]/init/route.ts
```

如果 `init/` 目录为空，一并删除：

```bash
rmdir src/app/api/tasks/[id]/init
```

**Step 2: 提交**

```bash
git add -A src/app/api/tasks/[id]/init
git commit -m "refactor: remove task init API route"
```

---

### Task 4: Runner — 删除 init/research 自动流程

**Files:**
- Modify: `src/lib/claude-runner.ts:121-144` (mode flags)
- Modify: `src/lib/claude-runner.ts:309-371` (init/research post-processing)

**Step 1: 简化 mode 判断**

`src/lib/claude-runner.ts:121` — 将 plan mode 判断从 `command.mode === 'plan' || command.mode === 'research' || command.mode === 'init'` 改为只检查 `plan`：

```typescript
  if (command.mode === 'plan') {
    args.push('--permission-mode', 'plan');
  }
```

**Step 2: 简化 resume 逻辑**

`src/lib/claude-runner.ts:131-144` — 删除 `command.mode !== 'init' && command.mode !== 'research'` 条件判断，简化为直接查找前一个有 sessionId 的命令：

```typescript
  // Resume session if available
  const prevCommand = db.select()
    .from(commands)
    .where(eq(commands.taskId, command.taskId))
    .all()
    .filter(c => c.sessionId && c.id !== commandId)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    .pop();

  if (prevCommand?.sessionId) {
    args.push('--resume', prevCommand.sessionId);
  }
```

**Step 3: 删除 init/research 后处理**

`src/lib/claude-runner.ts:309-371` — 在 `child.on('close', ...)` 回调中，删除以下两个代码块：
1. "If init command succeeded, find worktreeDir and create research command"（约 309-363 行）
2. "If research command succeeded, update task status to ready"（约 365-371 行）

同时删除文件顶部不再需要的 imports：`readdirSync`, `statSync`（如果只被 init 逻辑使用），以及 `getConfig` import。

也删除 `import { v4 as uuid } from 'uuid'` 如果不再被其他地方使用（检查 cleanupTask 是否用到——不用，所以可以删除）。

**Step 4: 验证构建**

Run: `cd /Users/macbookair/Desktop/projects/claude-agent-manager && npx tsc --noEmit 2>&1 | head -30`

**Step 5: 提交**

```bash
git add src/lib/claude-runner.ts
git commit -m "refactor: remove init/research auto-command pipeline from runner"
```

---

### Task 5: 创建任务 API — 原子创建 worktree

**Files:**
- Modify: `src/app/api/projects/[id]/tasks/route.ts`

**Step 1: 重写创建任务逻辑**

替换整个文件内容：

```typescript
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, projects } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const BRANCH_REGEX = /^[a-z0-9-]+$/;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const { description, branch: rawBranch } = await req.json();
  if (!description) return NextResponse.json({ error: '任务名称不能为空' }, { status: 400 });

  const taskId = uuid();
  const branch = rawBranch?.trim() || `task-${taskId.split('-')[0]}`;

  // Validate branch format
  if (!BRANCH_REGEX.test(branch)) {
    return NextResponse.json({ error: '分支名仅允许小写字母、数字和连字符' }, { status: 400 });
  }

  // Check branch conflict
  try {
    const existing = execFileSync('git', ['-C', project.workDir, 'branch', '--list', branch], { encoding: 'utf-8' }).trim();
    if (existing) {
      return NextResponse.json({ error: `分支 "${branch}" 已存在` }, { status: 409 });
    }
  } catch (e) {
    return NextResponse.json({ error: `检查分支失败: ${(e as Error).message}` }, { status: 500 });
  }

  // Ensure .worktrees directory exists
  const worktreesBase = join(project.workDir, '.worktrees');
  if (!existsSync(worktreesBase)) {
    mkdirSync(worktreesBase, { recursive: true });
  }

  // Atomic: create branch + worktree
  const worktreeDir = join(worktreesBase, branch);
  try {
    execFileSync('git', ['-C', project.workDir, 'worktree', 'add', worktreeDir, '-b', branch], { encoding: 'utf-8' });
  } catch (e) {
    return NextResponse.json({ error: `创建 worktree 失败: ${(e as Error).message}` }, { status: 500 });
  }

  // Insert task record
  db.insert(tasks).values({
    id: taskId,
    projectId,
    description,
    branch,
    worktreeDir,
  }).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  return NextResponse.json(task, { status: 201 });
}
```

**Step 2: 提交**

```bash
git add src/app/api/projects/[id]/tasks/route.ts
git commit -m "feat: atomic task creation with git branch and worktree"
```

---

### Task 6: 命令创建 API — 删除 status 门控

**Files:**
- Modify: `src/app/api/tasks/[id]/commands/route.ts:12-15`

**Step 1: 删除 task.status 检查**

删除这段代码（第 12-15 行）：

```typescript
  // Only allow creating commands when task is ready
  if (task.status !== 'ready') {
    return NextResponse.json({ error: '任务尚未就绪，请等待初始化和调研完成' }, { status: 403 });
  }
```

任务创建成功即可用，无需检查 status。

**Step 2: 提交**

```bash
git add src/app/api/tasks/[id]/commands/route.ts
git commit -m "refactor: remove task status gate from command creation"
```

---

### Task 7: 命令详情 API — 删除 taskStatus 字段

**Files:**
- Modify: `src/app/api/commands/[id]/route.ts:55`

**Step 1: 删除 taskStatus**

在 GET handler 的返回中，将 `taskStatus: task?.status ?? null` 删除：

```typescript
  return NextResponse.json({
    ...command,
    taskLastProviderId: task?.lastProviderId ?? null,
    taskLastMode: task?.lastMode ?? null,
    isLatestFinished,
    hasRunning,
  });
```

**Step 2: 也删除 init mode 的过滤**

第 38 行 `command.mode !== 'init'` 和第 44 行 `not(eq(commands.mode, 'init'))` 可以删除（不再有 init mode 命令）：

```typescript
    if (command.status && terminalStatuses.includes(command.status)) {
```

```typescript
        .where(and(
          eq(commands.taskId, command.taskId),
          inArray(commands.status, terminalStatuses),
        ))
```

**Step 3: 提交**

```bash
git add src/app/api/commands/[id]/route.ts
git commit -m "refactor: remove taskStatus and init mode filter from command API"
```

---

### Task 8: MCP create_task — 适配新参数

**Files:**
- Modify: `src/app/api/mcp/route.ts:18-56`

**Step 1: 更新 create_task 工具**

添加可选 `branch` 参数，调用同样的原子创建逻辑：

```typescript
  server.registerTool(
    'create_task',
    {
      description: 'Create a new task under a project with an isolated git worktree.',
      inputSchema: z.object({
        projectId: z.string().describe('The project ID to create the task under'),
        description: z.string().describe('Name/description of the task'),
        branch: z.string().optional().describe('Git branch name (lowercase, digits, hyphens only). Auto-generated if omitted.'),
      }),
    },
    async ({ projectId, description, branch: rawBranch }) => {
      try {
        const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
        if (!project) {
          return { content: [{ type: 'text' as const, text: `Error: Project ${projectId} not found` }], isError: true };
        }

        const taskId = uuid();
        const branch = rawBranch?.trim() || `task-${taskId.split('-')[0]}`;
        const BRANCH_REGEX = /^[a-z0-9-]+$/;

        if (!BRANCH_REGEX.test(branch)) {
          return { content: [{ type: 'text' as const, text: 'Error: branch name must match [a-z0-9-]+' }], isError: true };
        }

        // Check branch conflict
        const { execFileSync } = await import('child_process');
        const { join } = await import('path');
        const { mkdirSync, existsSync } = await import('fs');

        const existing = execFileSync('git', ['-C', project.workDir, 'branch', '--list', branch], { encoding: 'utf-8' }).trim();
        if (existing) {
          return { content: [{ type: 'text' as const, text: `Error: branch "${branch}" already exists` }], isError: true };
        }

        const worktreesBase = join(project.workDir, '.worktrees');
        if (!existsSync(worktreesBase)) mkdirSync(worktreesBase, { recursive: true });

        const worktreeDir = join(worktreesBase, branch);
        execFileSync('git', ['-C', project.workDir, 'worktree', 'add', worktreeDir, '-b', branch], { encoding: 'utf-8' });

        db.insert(tasks).values({ id: taskId, projectId, description, branch, worktreeDir }).run();
        const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
        return { content: [{ type: 'text' as const, text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to create task: ${(err as Error).message}` }], isError: true };
      }
    }
  );
```

**Step 2: 提交**

```bash
git add src/app/api/mcp/route.ts
git commit -m "feat: update MCP create_task with branch and worktree creation"
```

---

### Task 9: 创建任务弹窗 UI — name + branch 字段

**Files:**
- Modify: `src/components/projects/create-task-dialog.tsx`

**Step 1: 重写弹窗组件**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

interface CreateTaskDialogProps {
  projectId: string;
  onCreated: () => void;
}

const BRANCH_REGEX = /^[a-z0-9-]*$/;

export function CreateTaskDialog({ projectId, onCreated }: CreateTaskDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);

  const branchValid = BRANCH_REGEX.test(branch);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (branch && !branchValid) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: name.trim(), branch: branch.trim() || undefined }),
      });
      if (res.ok) {
        setOpen(false);
        setName('');
        setBranch('');
        onCreated();
      } else {
        const data = await res.json().catch(() => ({ error: '创建失败' }));
        toast.error(data.error || '创建失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />新建任务</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-name">任务名称</Label>
            <Input
              id="task-name"
              placeholder="输入任务名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-branch">分支名（选填）</Label>
            <Input
              id="task-branch"
              placeholder="不填则自动生成 task-xxx"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className={`font-mono ${branch && !branchValid ? 'border-destructive' : ''}`}
            />
            {branch && !branchValid && (
              <p className="text-xs text-destructive">仅允许小写字母、数字和连字符</p>
            )}
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={loading || !name.trim() || (!!branch && !branchValid)}>
            {loading ? '创建中...' : '创建任务'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: 提交**

```bash
git add src/components/projects/create-task-dialog.tsx
git commit -m "feat: update create task dialog with name and branch fields"
```

---

### Task 10: 项目详情页 — 删除任务状态徽章

**Files:**
- Modify: `src/app/projects/[id]/page.tsx:13-21,31-36,103-111`

**Step 1: 删除任务状态相关代码**

1. 删除 Task 接口中的 `status` 字段
2. 删除 `taskStatusConfig` 对象（第 31-36 行）
3. 任务卡片中删除 Badge 状态显示，改为直接显示任务名称和分支名

任务卡片变为：

```tsx
{project.tasks.map((task) => (
  <Link key={task.id} href={`/tasks/${task.id}`}>
    <Card className="hover:bg-accent/50 transition-colors">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex-1">{task.description}</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => handleDeleteTask(task.id, e)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CardDescription className="text-xs font-mono">{task.branch}</CardDescription>
        {task.updatedAt && (
          <CardDescription className="text-xs">
            活跃：{new Date(task.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </CardDescription>
        )}
      </CardHeader>
    </Card>
  </Link>
))}
```

也可以移除 `Badge` import（如果不再使用）。

**Step 2: 提交**

```bash
git add src/app/projects/[id]/page.tsx
git commit -m "refactor: remove task status badge from project detail page"
```

---

### Task 11: 任务详情页 — 大幅简化

**Files:**
- Modify: `src/app/tasks/[id]/page.tsx`

**Step 1: 清理接口和状态**

1. Task 接口中删除 `status` 字段
2. 删除 `taskStatusMap` 对象（第 52-58 行）
3. 删除 `initializing` state（第 73 行）
4. 删除 `handleInit` 函数（第 129-142 行）
5. 删除 `isTaskReady` 和 `isTaskPending` 变量（第 145-146 行）
6. 简化 `inputDisabled`：`const inputDisabled = hasRunning || noProvider`（去掉 `!isTaskReady`）

**Step 2: 简化 Header**

删除状态 Badge 和名称弹窗 Dialog。Header 变为：

```tsx
<div className="px-4 py-3 border-b">
  <div className="flex items-center gap-2 mb-1">
    <Button variant="ghost" size="sm" className="p-1" onClick={() => router.back()}>
      <ArrowLeft className="h-4 w-4" />
    </Button>
    <span className="text-sm font-medium flex-1 truncate">{task.description}</span>
    <div className="flex-1" />
    <Button variant="ghost" size="sm" className="p-1 text-destructive hover:text-destructive" onClick={handleDelete}>
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
  {task.branch && (
    <p className="text-xs text-muted-foreground font-mono ml-8">{task.branch}</p>
  )}
</div>
```

**Step 3: 简化 Input Area**

删除三个条件分支（pending/initializing/ready），只保留命令输入框。去掉 `isTaskReady` 包裹和 `isTaskPending` 分支：

```tsx
{/* Input Area */}
<div className="border-t px-4 py-3">
  {noProvider && (
    <p className="text-xs text-destructive mb-2">
      尚未配置 Provider，请先前往<Link href="/settings" className="underline ml-0.5">系统设置</Link>添加
    </p>
  )}

  {!noProvider && (
    <>
      <div className="flex items-center gap-2 mb-2">
        {/* provider select, mode toggle, draft toggle — same as current ready state */}
      </div>
      <div className="flex gap-2">
        {/* textarea + send button — same as current ready state */}
      </div>
    </>
  )}
</div>
```

**Step 4: 清理 imports**

删除不再使用的 imports：`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogTrigger`, `Badge`, `Loader2`, `Play`。

**Step 5: 命令列表中删除 init/research mode Badge**

在命令列表的 mode 显示中（约第 362-363 行），删除 init 和 research 的 Badge：

```tsx
{cmd.mode === 'plan' && <Badge variant="outline" className="text-xs">Plan</Badge>}
```

**Step 6: 提交**

```bash
git add src/app/tasks/[id]/page.tsx
git commit -m "refactor: simplify task detail page, remove init/status UI"
```

---

### Task 12: 命令详情页 — 删除 taskStatus 引用

**Files:**
- Modify: `src/app/commands/[id]/page.tsx:31,160-161,205-206`

**Step 1: 更新接口**

从 `CommandDetail` 接口中删除 `taskStatus` 字段。

**Step 2: 更新 canShowInput 条件**

```typescript
  const canShowInput = command
    && command.isLatestFinished
    && !command.hasRunning;
```

**Step 3: 删除 init/research mode Badge**

在 header 部分（约第 205-206 行）删除：
```tsx
{command.mode === 'init' && <Badge variant="outline">Init</Badge>}
{command.mode === 'research' && <Badge variant="outline">调研</Badge>}
```

**Step 4: 提交**

```bash
git add src/app/commands/[id]/page.tsx
git commit -m "refactor: remove taskStatus and init/research badges from command detail"
```

---

### Task 13: 构建验证 + 集成测试

**Step 1: TypeScript 编译检查**

Run: `cd /Users/macbookair/Desktop/projects/claude-agent-manager && npx tsc --noEmit`
Expected: 无错误。

**Step 2: Next.js 构建**

Run: `cd /Users/macbookair/Desktop/projects/claude-agent-manager && pnpm build`
Expected: 构建成功。

**Step 3: 修复任何错误**

如果有错误，修复后提交。

**Step 4: 最终提交**

```bash
git add -A
git commit -m "fix: resolve any remaining type errors after task simplification"
```

---

## 执行顺序

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12 → Task 13

Tasks 1-4 是清理旧代码，Task 5 是核心新功能，Tasks 6-8 是 API 适配，Tasks 9-12 是 UI 适配，Task 13 是验证。
