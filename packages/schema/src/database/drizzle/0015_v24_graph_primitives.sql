CREATE TABLE `apply_log` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`response` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_link` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`src_id` text NOT NULL,
	`dst_id` text,
	`kind` text NOT NULL,
	`ref` text,
	`note` text,
	FOREIGN KEY (`src_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dst_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_link_src_id_idx` ON `task_link` (`src_id`);--> statement-breakpoint
CREATE INDEX `task_link_dst_id_idx` ON `task_link` (`dst_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_link_unique` ON `task_link` (`src_id`,`dst_id`,`kind`);--> statement-breakpoint
CREATE TABLE `task_rollup` (
	`task_id` text PRIMARY KEY NOT NULL,
	`direct_done` integer DEFAULT 0 NOT NULL,
	`direct_total` integer DEFAULT 0 NOT NULL,
	`subtree_done` integer DEFAULT 0 NOT NULL,
	`subtree_total` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `task` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `task` ADD `rank` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `rev` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `kind` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `completion_policy` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `completed_via` text;--> statement-breakpoint
ALTER TABLE `task` ADD `claimed_by` text;--> statement-breakpoint
ALTER TABLE `task` ADD `claimed_at` text;--> statement-breakpoint
CREATE INDEX `task_parent_id_idx` ON `task` (`parent_id`);