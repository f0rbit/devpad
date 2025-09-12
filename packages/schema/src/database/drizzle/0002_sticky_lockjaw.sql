-- Add deleted column to action table
CREATE TABLE `action_new` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`data` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `action_new` (id, owner_id, type, description, data, created_at, updated_at)
SELECT id, owner_id, type, description, data, created_at, updated_at FROM `action`;--> statement-breakpoint
DROP TABLE `action`;--> statement-breakpoint
ALTER TABLE `action_new` RENAME TO `action`;--> statement-breakpoint
-- Add created_at, updated_at, deleted columns to api_key table
CREATE TABLE `api_key_new` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `api_key_new` (id, owner_id, hash)
SELECT id, owner_id, hash FROM `api_key`;--> statement-breakpoint
UPDATE `api_key_new` SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL;--> statement-breakpoint
DROP TABLE `api_key`;--> statement-breakpoint
ALTER TABLE `api_key_new` RENAME TO `api_key`;--> statement-breakpoint
-- Add created_at, updated_at, deleted columns to checklist_item table
CREATE TABLE `checklist_item_new` (
	`id` text PRIMARY KEY NOT NULL,
	`checklist_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`checklist_id`) REFERENCES `checklist`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `checklist_item_new` (id, checklist_id, parent_id, name, checked)
SELECT id, checklist_id, parent_id, name, checked FROM `checklist_item`;--> statement-breakpoint
UPDATE `checklist_item_new` SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL;--> statement-breakpoint
DROP TABLE `checklist_item`;--> statement-breakpoint
ALTER TABLE `checklist_item_new` RENAME TO `checklist_item`;--> statement-breakpoint
-- Add deleted column to task table
CREATE TABLE `task_new` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`progress` text DEFAULT 'UNSTARTED' NOT NULL,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL,
	`goal_id` text,
	`project_id` text,
	`description` text,
	`start_time` text,
	`end_time` text,
	`summary` text,
	`codebase_task_id` text,
	`priority` text DEFAULT 'LOW' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP),
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`codebase_task_id`) REFERENCES `codebase_tasks`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `task_new` (id, owner_id, title, progress, visibility, goal_id, project_id, description, start_time, end_time, summary, codebase_task_id, priority, created_at, updated_at)
SELECT id, owner_id, title, progress, visibility, goal_id, project_id, description, start_time, end_time, summary, codebase_task_id, priority, created_at, updated_at FROM `task`;--> statement-breakpoint
DROP TABLE `task`;--> statement-breakpoint
ALTER TABLE `task_new` RENAME TO `task`;