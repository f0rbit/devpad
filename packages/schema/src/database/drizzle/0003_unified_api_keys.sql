-- Unify api_key, blog access_keys, and media_api_keys into a single api_keys table
DROP TABLE IF EXISTS `api_key`;--> statement-breakpoint
DROP TABLE IF EXISTS `access_keys`;--> statement-breakpoint
DROP TABLE IF EXISTS `media_api_keys`;--> statement-breakpoint
DROP TABLE IF EXISTS `media_users`;--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`name` text,
	`note` text,
	`scope` text DEFAULT 'all' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
