# Phase 1: 数据模型变更 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为自主任务管理器扩展 tasks 和 commands 表，新增 mode/goal/manager 相关字段，并建立项目测试基础设施。

**Architecture:** 在现有 Drizzle ORM schema 上新增列，所有新列均为可选（nullable）或带 default，确保向后兼容。同时新增 `max_autonomous_rounds` 和 `safety_net_delay_ms` 两个配置项。测试使用内存 SQLite 数据库隔离，不影响开发数据。

**Tech Stack:** Drizzle ORM + SQLite, Vitest (单元/集成测试), TypeScript

**Design Doc:** `docs/plans/2026-03-05-autonomous-task-manager-design.md`

---

## Task 0: 搭建 Vitest 测试基础设施

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (新增 devDependencies 和 scripts)
- Create: `src/lib/__tests__/db-test-utils.ts` (测试用内存数据库工厂)

**Step 1: 安装 Vitest 依赖**

```bash
pnpm add -D vitest @vitest/coverage-v8
```

**Step 2: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/__tests__/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Step 3: 在 package.json 添加 test scripts**

在 `"scripts"` 中新增：
```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

**Step 4: 创建测试用内存数据库工厂**

`src/lib/__tests__/db-test-utils.ts`:

```typescript
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });

  // 根据 schema 创建表（内存数据库需手动建表）
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      work_dir TEXT NOT NULL,
      git_remote TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      description TEXT NOT NULL,
      branch TEXT NOT NULL,
      worktree_dir TEXT,
      last_provider_id TEXT,
      last_mode TEXT,
      mode TEXT DEFAULT 'manual',
      goal TEXT,
      manager_session_id TEXT,
      manager_provider_id TEXT,
      worker_provider_id TEXT,
      autonomous_round INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE commands (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      prompt TEXT NOT NULL,
      mode TEXT DEFAULT 'execute',
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      provider_id TEXT,
      result TEXT,
      log_file TEXT,
      exec_env TEXT,
      session_id TEXT,
      pid INTEGER,
      role TEXT DEFAULT 'worker',
      manager_summary TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      env_json TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return { db: testDb, sqlite };
}
```

> **注意：** 内存数据库的建表 SQL 已包含 Phase 1 新增字段（mode, goal, manager_session_id 等），因为测试和 schema 变更是同步进行的。

**Step 5: 验证 vitest 能运行**

```bash
pnpm test
```

Expected: 无测试文件，0 tests passed。

**Step 6: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml src/lib/__tests__/db-test-utils.ts
git commit -m "chore: setup vitest test infrastructure with in-memory SQLite factory"
```

---

## Task 1: TDD — tasks 表新增字段

**Files:**
- Create: `src/lib/__tests__/schema-tasks.test.ts`
- Modify: `src/lib/schema.ts` (tasks 表)

**Step 1: 编写失败测试**

`src/lib/__tests__/schema-tasks.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects } from '../schema';
import { eq } from 'drizzle-orm';

describe('tasks schema - autonomous fields', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  beforeEach(() => {
    const testEnv = createTestDb();
    db = testEnv.db;
    sqlite = testEnv.sqlite;

    // 插入测试项目
    db.insert(projects).values({
      id: 'proj-1',
      name: 'Test Project',
      workDir: '/tmp/test',
    }).run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should have mode field defaulting to "manual"', () => {
    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test-branch',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-1')).get();
    expect(task?.mode).toBe('manual');
  });

  it('should allow setting mode to "autonomous"', () => {
    db.insert(tasks).values({
      id: 'task-2',
      projectId: 'proj-1',
      description: 'Autonomous task',
      branch: 'auto-branch',
      mode: 'autonomous',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-2')).get();
    expect(task?.mode).toBe('autonomous');
  });

  it('should store goal text', () => {
    const goal = '实现用户认证模块，包含登录、注册、JWT 验证';
    db.insert(tasks).values({
      id: 'task-3',
      projectId: 'proj-1',
      description: 'Auth task',
      branch: 'auth-branch',
      goal,
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-3')).get();
    expect(task?.goal).toBe(goal);
  });

  it('should have goal as null by default', () => {
    db.insert(tasks).values({
      id: 'task-4',
      projectId: 'proj-1',
      description: 'No goal task',
      branch: 'no-goal',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-4')).get();
    expect(task?.goal).toBeNull();
  });

  it('should store managerSessionId', () => {
    db.insert(tasks).values({
      id: 'task-5',
      projectId: 'proj-1',
      description: 'Manager task',
      branch: 'mgr-branch',
      managerSessionId: 'session-abc-123',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-5')).get();
    expect(task?.managerSessionId).toBe('session-abc-123');
  });

  it('should store managerProviderId and workerProviderId', () => {
    db.insert(tasks).values({
      id: 'task-6',
      projectId: 'proj-1',
      description: 'Provider task',
      branch: 'prov-branch',
      managerProviderId: 'provider-mgr',
      workerProviderId: 'provider-wkr',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-6')).get();
    expect(task?.managerProviderId).toBe('provider-mgr');
    expect(task?.workerProviderId).toBe('provider-wkr');
  });

  it('should have autonomousRound defaulting to 0', () => {
    db.insert(tasks).values({
      id: 'task-7',
      projectId: 'proj-1',
      description: 'Round task',
      branch: 'round-branch',
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-7')).get();
    expect(task?.autonomousRound).toBe(0);
  });

  it('should allow incrementing autonomousRound', () => {
    db.insert(tasks).values({
      id: 'task-8',
      projectId: 'proj-1',
      description: 'Increment task',
      branch: 'inc-branch',
      autonomousRound: 5,
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-8')).get();
    expect(task?.autonomousRound).toBe(5);
  });

  it('should support full autonomous task creation with all new fields', () => {
    db.insert(tasks).values({
      id: 'task-full',
      projectId: 'proj-1',
      description: 'Full autonomous task',
      branch: 'full-branch',
      mode: 'autonomous',
      goal: '完成所有自主模式字段的测试',
      managerSessionId: 'session-full',
      managerProviderId: 'mgr-prov',
      workerProviderId: 'wkr-prov',
      autonomousRound: 3,
    }).run();

    const task = db.select().from(tasks).where(eq(tasks.id, 'task-full')).get();
    expect(task).toMatchObject({
      id: 'task-full',
      mode: 'autonomous',
      goal: '完成所有自主模式字段的测试',
      managerSessionId: 'session-full',
      managerProviderId: 'mgr-prov',
      workerProviderId: 'wkr-prov',
      autonomousRound: 3,
    });
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/schema-tasks.test.ts
```

Expected: FAIL — schema 中缺少 mode, goal 等字段。

**Step 3: 修改 schema.ts — tasks 表**

在 `src/lib/schema.ts` 的 `tasks` 表定义中，`updatedAt` 之前新增以下字段：

```typescript
mode: text('mode').default('manual'),
goal: text('goal'),
managerSessionId: text('manager_session_id'),
managerProviderId: text('manager_provider_id'),
workerProviderId: text('worker_provider_id'),
autonomousRound: integer('autonomous_round').default(0),
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/schema-tasks.test.ts
```

Expected: ALL PASS (9 tests)

**Step 5: Commit**

```bash
git add src/lib/__tests__/schema-tasks.test.ts src/lib/schema.ts
git commit -m "feat: add autonomous mode fields to tasks schema (TDD)"
```

---

## Task 2: TDD — commands 表新增字段

**Files:**
- Create: `src/lib/__tests__/schema-commands.test.ts`
- Modify: `src/lib/schema.ts` (commands 表)

**Step 1: 编写失败测试**

`src/lib/__tests__/schema-commands.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './db-test-utils';
import { tasks, projects, commands } from '../schema';
import { eq } from 'drizzle-orm';

describe('commands schema - role and managerSummary fields', () => {
  let db: ReturnType<typeof createTestDb>['db'];
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];

  beforeEach(() => {
    const testEnv = createTestDb();
    db = testEnv.db;
    sqlite = testEnv.sqlite;

    db.insert(projects).values({
      id: 'proj-1',
      name: 'Test Project',
      workDir: '/tmp/test',
    }).run();

    db.insert(tasks).values({
      id: 'task-1',
      projectId: 'proj-1',
      description: 'Test task',
      branch: 'test-branch',
    }).run();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('should have role field defaulting to "worker"', () => {
    db.insert(commands).values({
      id: 'cmd-1',
      taskId: 'task-1',
      prompt: 'Do something',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-1')).get();
    expect(cmd?.role).toBe('worker');
  });

  it('should allow setting role to "manager"', () => {
    db.insert(commands).values({
      id: 'cmd-2',
      taskId: 'task-1',
      prompt: 'Review worker output',
      role: 'manager',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-2')).get();
    expect(cmd?.role).toBe('manager');
  });

  it('should store managerSummary', () => {
    const summary = '已完成认证模块，所有测试通过，建议下一步实现授权中间件';
    db.insert(commands).values({
      id: 'cmd-3',
      taskId: 'task-1',
      prompt: 'Implement auth',
      managerSummary: summary,
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-3')).get();
    expect(cmd?.managerSummary).toBe(summary);
  });

  it('should have managerSummary as null by default', () => {
    db.insert(commands).values({
      id: 'cmd-4',
      taskId: 'task-1',
      prompt: 'Regular command',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-4')).get();
    expect(cmd?.managerSummary).toBeNull();
  });

  it('should support manager command with full fields', () => {
    db.insert(commands).values({
      id: 'cmd-full',
      taskId: 'task-1',
      prompt: 'Review and decide next step',
      mode: 'plan',
      status: 'queued',
      role: 'manager',
      managerSummary: '工作完成，质量合格',
    }).run();

    const cmd = db.select().from(commands).where(eq(commands.id, 'cmd-full')).get();
    expect(cmd).toMatchObject({
      id: 'cmd-full',
      role: 'manager',
      mode: 'plan',
      status: 'queued',
      managerSummary: '工作完成，质量合格',
    });
  });
});
```

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/schema-commands.test.ts
```

Expected: FAIL — schema 中缺少 role, managerSummary 字段。

**Step 3: 修改 schema.ts — commands 表**

在 `src/lib/schema.ts` 的 `commands` 表定义中，`pid` 之后新增：

```typescript
role: text('role').default('worker'),
managerSummary: text('manager_summary'),
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/schema-commands.test.ts
```

Expected: ALL PASS (5 tests)

**Step 5: Commit**

```bash
git add src/lib/__tests__/schema-commands.test.ts src/lib/schema.ts
git commit -m "feat: add role and managerSummary fields to commands schema (TDD)"
```

---

## Task 3: TDD — config 新增自主模式配置项

**Files:**
- Create: `src/lib/__tests__/config-autonomous.test.ts`
- Modify: `src/lib/config.ts`

**Step 1: 编写失败测试**

`src/lib/__tests__/config-autonomous.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from '../config';

describe('autonomous mode config defaults', () => {
  it('should have max_autonomous_rounds default of 20', () => {
    expect(CONFIG_DEFAULTS.max_autonomous_rounds).toBe('20');
  });

  it('should have safety_net_delay_ms default of 3000', () => {
    expect(CONFIG_DEFAULTS.safety_net_delay_ms).toBe('3000');
  });

  it('should include autonomous config keys in CONFIG_KEYS', () => {
    const { CONFIG_KEYS } = require('../config');
    expect(CONFIG_KEYS).toContain('max_autonomous_rounds');
    expect(CONFIG_KEYS).toContain('safety_net_delay_ms');
  });
});
```

> **注意：** 此测试不需要数据库，只验证导出的常量。为了测试 CONFIG_DEFAULTS，需将 config.ts 中的 `CONFIG_DEFAULTS` 改为 `export`。

**Step 2: 运行测试验证失败**

```bash
pnpm test src/lib/__tests__/config-autonomous.test.ts
```

Expected: FAIL — CONFIG_DEFAULTS 未导出且缺少新配置项。

**Step 3: 修改 config.ts**

1. 将 `const CONFIG_DEFAULTS` 改为 `export const CONFIG_DEFAULTS`
2. 在 `CONFIG_DEFAULTS` 对象中新增：

```typescript
max_autonomous_rounds: '20',
safety_net_delay_ms: '3000',
```

**Step 4: 运行测试验证通过**

```bash
pnpm test src/lib/__tests__/config-autonomous.test.ts
```

Expected: ALL PASS (3 tests)

**Step 5: Commit**

```bash
git add src/lib/__tests__/config-autonomous.test.ts src/lib/config.ts
git commit -m "feat: add autonomous mode config defaults (max_rounds, safety_net_delay)"
```

---

## Task 4: 同步数据库并验证

**Step 1: 运行全量测试确认所有测试通过**

```bash
pnpm test
```

Expected: ALL PASS (17 tests: 9 + 5 + 3)

**Step 2: 执行 db:push 同步本地数据库**

```bash
pnpm db:push
```

Expected: drizzle-kit 检测到 tasks 表新增 6 列、commands 表新增 2 列，执行 ALTER TABLE ADD COLUMN。

> **风险评估：** 所有新增字段都是 nullable 或带 DEFAULT，且不修改任何现有 DEFAULT 表达式，属于纯 ADD COLUMN 操作，不会触发 SQLite 表重建。安全。

**Step 3: 验证构建不报错**

```bash
pnpm build
```

Expected: Build 成功，无 TypeScript 错误。

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: sync database schema for autonomous mode fields"
```

---

## Phase 1 完成标准

- [ ] Vitest 基础设施就绪（vitest.config.ts, test scripts, 内存 DB 工厂）
- [ ] tasks 表新增 6 字段：mode, goal, managerSessionId, managerProviderId, workerProviderId, autonomousRound
- [ ] commands 表新增 2 字段：role, managerSummary
- [ ] config 新增 2 配置项：max_autonomous_rounds (20), safety_net_delay_ms (3000)
- [ ] 17 个测试全部通过
- [ ] db:push 成功
- [ ] pnpm build 成功
- [ ] 所有变更已 commit
