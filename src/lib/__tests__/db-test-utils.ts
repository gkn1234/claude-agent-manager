import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const testDb = drizzle(sqlite, { schema });

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
