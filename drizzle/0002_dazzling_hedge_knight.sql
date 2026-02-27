CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`env_json` text NOT NULL,
	`is_default` integer DEFAULT 0,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
ALTER TABLE `commands` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `commands` ADD `exec_env` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_provider_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `last_mode` text;