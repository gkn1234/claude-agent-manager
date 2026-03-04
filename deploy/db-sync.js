/**
 * 一次性数据库结构同步脚本
 * 将现有数据库的表结构对齐到 schema.ts 定义（DEFAULT 表达式、缺失列等）
 *
 * 用法: node deploy/db-sync.js
 * 执行完后 drizzle-kit push 即为幂等操作
 */
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/dispatch.db';
const db = new Database(DB_PATH);

console.log(`同步数据库: ${DB_PATH}`);

db.pragma('foreign_keys = OFF');

// 清理之前失败遗留的临时表
const tempTables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__new_%'"
).all();
for (const t of tempTables) {
  console.log(`  清理残留临时表: ${t.name}`);
  db.exec(`DROP TABLE "${t.name}"`);
}

// 需要重建的表定义（与 schema.ts 完全一致）
const rebuilds = [
  {
    table: 'projects',
    create: `CREATE TABLE __new_projects (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      work_dir text NOT NULL,
      git_remote text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    cols: 'id, name, work_dir, git_remote, created_at, updated_at',
  },
  {
    table: 'tasks',
    create: `CREATE TABLE __new_tasks (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      description text NOT NULL,
      branch text NOT NULL,
      worktree_dir text,
      last_provider_id text,
      last_mode text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )`,
    cols: 'id, project_id, description, branch, worktree_dir, last_provider_id, last_mode, created_at, updated_at',
  },
  {
    table: 'commands',
    create: `CREATE TABLE __new_commands (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      prompt text NOT NULL,
      mode text DEFAULT 'execute',
      status text DEFAULT 'pending',
      priority integer DEFAULT 0,
      provider_id text,
      result text,
      log_file text,
      exec_env text,
      session_id text,
      pid integer,
      started_at text,
      finished_at text,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )`,
    cols: 'id, task_id, prompt, mode, status, priority, provider_id, result, log_file, exec_env, session_id, pid, started_at, finished_at, created_at',
  },
  {
    table: 'providers',
    create: `CREATE TABLE __new_providers (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      env_json text NOT NULL,
      is_default integer DEFAULT 0,
      sort_order integer DEFAULT 0,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`,
    cols: 'id, name, env_json, is_default, sort_order, created_at, updated_at',
    // 旧表可能没有 sort_order 列，用 0 作为默认值
    selectCols: 'id, name, env_json, is_default, 0, created_at, updated_at',
  },
];

for (const r of rebuilds) {
  // 检查源表是否存在
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?"
  ).get(r.table);
  if (!exists) {
    console.log(`  跳过 ${r.table}（表不存在）`);
    continue;
  }

  // 检查是否需要特殊的 SELECT（缺失列）
  let selectCols = r.selectCols || r.cols;
  if (r.selectCols) {
    // 如果源表已有目标列，使用正常 SELECT
    const tableInfo = db.prepare(`PRAGMA table_info(${r.table})`).all();
    const colNames = tableInfo.map(c => c.name);
    const targetCols = r.cols.split(',').map(c => c.trim());
    const allExist = targetCols.every(c => colNames.includes(c));
    if (allExist) {
      selectCols = r.cols;
    }
  }

  console.log(`  重建 ${r.table}...`);
  db.exec(r.create);
  db.exec(`INSERT INTO __new_${r.table}(${r.cols}) SELECT ${selectCols} FROM ${r.table}`);
  db.exec(`DROP TABLE ${r.table}`);
  db.exec(`ALTER TABLE __new_${r.table} RENAME TO ${r.table}`);
}

db.pragma('foreign_keys = ON');
db.close();

console.log('数据库结构同步完成！');
