import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';

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
  status: text('status').default('initializing'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

export const commands = sqliteTable('commands', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  prompt: text('prompt').notNull(),
  mode: text('mode').default('execute'),
  status: text('status').default('pending'),
  priority: integer('priority').default(0),
  result: text('result'),
  logFile: text('log_file'),
  sessionId: text('session_id'),
  pid: integer('pid'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Relations for query API
export const projectsRelations = relations(projects, ({ many }) => ({
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  commands: many(commands),
}));

export const commandsRelations = relations(commands, ({ one }) => ({
  task: one(tasks, { fields: [commands.taskId], references: [tasks.id] }),
}));
