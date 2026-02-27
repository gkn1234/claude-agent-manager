CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`prompt` text NOT NULL,
	`mode` text DEFAULT 'execute',
	`status` text DEFAULT 'pending',
	`priority` integer DEFAULT 0,
	`result` text,
	`log_file` text,
	`session_id` text,
	`pid` integer,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`work_dir` text NOT NULL,
	`git_remote` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`description` text NOT NULL,
	`branch` text,
	`worktree_dir` text,
	`status` text DEFAULT 'initializing',
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
