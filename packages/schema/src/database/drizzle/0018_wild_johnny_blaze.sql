CREATE TABLE `hook` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`project_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger` text NOT NULL,
	`action` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hook_project_id_idx` ON `hook` (`project_id`);--> statement-breakpoint
CREATE TABLE `hook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`hook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`hook_id`) REFERENCES `hook`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hook_delivery_hook_id_idx` ON `hook_delivery` (`hook_id`);--> statement-breakpoint
CREATE INDEX `hook_delivery_status_idx` ON `hook_delivery` (`status`);