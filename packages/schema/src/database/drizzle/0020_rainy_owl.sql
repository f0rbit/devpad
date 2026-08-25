CREATE TABLE `annotation_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`blocking` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `annotation_thread_document_id_idx` ON `annotation_thread` (`document_id`);--> statement-breakpoint
CREATE INDEX `annotation_thread_status_idx` ON `annotation_thread` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `annotation_thread_unique` ON `annotation_thread` (`document_id`,`thread_id`);--> statement-breakpoint
CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`head_version` text,
	`status` text DEFAULT 'draft' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_project_id_idx` ON `document` (`project_id`);--> statement-breakpoint
CREATE INDEX `document_task_id_idx` ON `document` (`task_id`);--> statement-breakpoint
CREATE TABLE `signoff` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`checkpoint` text NOT NULL,
	`task_id` text,
	`decision` text,
	`decided_by` text,
	`decided_at` text,
	`reason` text,
	`content_hash` text,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `signoff_subject_idx` ON `signoff` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `signoff_task_id_idx` ON `signoff` (`task_id`);--> statement-breakpoint
ALTER TABLE `task` ADD `stage` text;