CREATE TABLE `github_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`delivery_guid` text NOT NULL,
	`event_type` text NOT NULL,
	`processed_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `github_webhook_event_delivery_guid_idx` ON `github_webhook_event` (`delivery_guid`);--> statement-breakpoint
ALTER TABLE `project` ADD `github_autoclose` integer DEFAULT false NOT NULL;