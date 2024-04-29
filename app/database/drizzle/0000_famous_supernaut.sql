CREATE TABLE `action` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`data` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `api_key` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`hash` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checklist` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`checklist_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`checklist_id`) REFERENCES `checklist`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`target_time` text,
	`deleted` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestone`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `milestone` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`target_time` text,
	`deleted` integer,
	`target_version` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text,
	`after_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`specification` text,
	`repo_url` text,
	`repo_id` integer,
	`icon_url` text,
	`status` text DEFAULT 'DEVELOPMENT' NOT NULL,
	`deleted` integer,
	`link_url` text,
	`link_text` text,
	`visibility` text,
	`current_version` text,
	`config_json` text
);
--> statement-breakpoint
CREATE TABLE `project_goal` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`project_id` text,
	`description` text,
	`target_time` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer,
	`target_version` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`finished_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`access_token` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`color` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text NOT NULL,
	`title` text NOT NULL,
	`progress` text,
	`visibility` text,
	`goal_id` text,
	`description` text,
	`start_time` text,
	`end_time` text,
	`summary` text,
	`priority` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP),
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_tag` (
	`task_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`tag_id`, `task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `todo_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`old_id` integer,
	`new_id` integer NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`old_id`) REFERENCES `tracker_result`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`new_id`) REFERENCES `tracker_result`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tracker_result` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`data` text NOT NULL,
	`accepted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` integer,
	`name` text,
	`email` text,
	`email_verified` text,
	`image_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_owner_id_project_id_unique` ON `project` (`owner_id`,`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);