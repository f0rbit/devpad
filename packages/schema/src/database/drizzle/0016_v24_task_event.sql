CREATE TABLE `task_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`project_id` text,
	`actor` text NOT NULL,
	`payload` text NOT NULL,
	`occurred_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`dispatch_status` text DEFAULT 'pending' NOT NULL,
	`dispatched_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_event_event_id_unique` ON `task_event` (`event_id`);--> statement-breakpoint
CREATE INDEX `task_event_subject_id_idx` ON `task_event` (`subject_id`);--> statement-breakpoint
CREATE INDEX `task_event_dispatch_status_idx` ON `task_event` (`dispatch_status`);