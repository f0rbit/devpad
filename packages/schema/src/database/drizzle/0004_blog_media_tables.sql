CREATE TABLE `blog_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`parent` text DEFAULT 'root'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_owner_name_unique` ON `blog_categories` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `blog_fetch_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`integration_id` integer NOT NULL,
	`identifier` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `blog_integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fetch_links_integration_identifier_unique` ON `blog_fetch_links` (`integration_id`,`identifier`);--> statement-breakpoint
CREATE TABLE `blog_integrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`location` text NOT NULL,
	`data` text,
	`last_fetch` integer,
	`status` text DEFAULT 'pending',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blog_post_projects` (
	`post_id` integer NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`post_id`, `project_id`),
	FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `blog_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`author_id` text NOT NULL,
	`slug` text NOT NULL,
	`corpus_version` text,
	`category` text DEFAULT 'root' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`publish_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blog_posts_uuid_unique` ON `blog_posts` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_author_slug_unique` ON `blog_posts` (`author_id`,`slug`);--> statement-breakpoint
CREATE TABLE `blog_tags` (
	`post_id` integer NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`post_id`, `tag`),
	FOREIGN KEY (`post_id`) REFERENCES `blog_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `corpus_snapshots` (
	`store_id` text NOT NULL,
	`version` text NOT NULL,
	`parents` text NOT NULL,
	`created_at` text NOT NULL,
	`invoked_at` text,
	`content_hash` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`data_key` text NOT NULL,
	`tags` text,
	PRIMARY KEY(`store_id`, `version`)
);
--> statement-breakpoint
CREATE INDEX `idx_store_created` ON `corpus_snapshots` (`store_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_content_hash` ON `corpus_snapshots` (`store_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_data_key` ON `corpus_snapshots` (`data_key`);--> statement-breakpoint
CREATE TABLE `media_account_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `media_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_account_settings_unique` ON `media_account_settings` (`account_id`,`setting_key`);--> statement-breakpoint
CREATE INDEX `idx_media_account_settings_account` ON `media_account_settings` (`account_id`);--> statement-breakpoint
CREATE TABLE `media_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`platform` text NOT NULL,
	`platform_user_id` text,
	`platform_username` text,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text,
	`token_expires_at` text,
	`is_active` integer DEFAULT true,
	`last_fetched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `media_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_accounts_profile` ON `media_accounts` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_accounts_profile_platform_user` ON `media_accounts` (`profile_id`,`platform`,`platform_user_id`);--> statement-breakpoint
CREATE TABLE `media_platform_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`platform` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_encrypted` text NOT NULL,
	`redirect_uri` text,
	`metadata` text,
	`is_verified` integer DEFAULT false,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `media_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_platform_credentials_unique` ON `media_platform_credentials` (`profile_id`,`platform`);--> statement-breakpoint
CREATE INDEX `idx_platform_credentials_profile` ON `media_platform_credentials` (`profile_id`);--> statement-breakpoint
CREATE TABLE `media_profile_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`account_id` text NOT NULL,
	`filter_type` text NOT NULL,
	`filter_key` text NOT NULL,
	`filter_value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `media_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `media_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_media_profile_filters_profile` ON `media_profile_filters` (`profile_id`);--> statement-breakpoint
CREATE INDEX `idx_media_profile_filters_account` ON `media_profile_filters` (`account_id`);--> statement-breakpoint
CREATE TABLE `media_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`theme` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_media_profiles_user` ON `media_profiles` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_profiles_user_slug` ON `media_profiles` (`user_id`,`slug`);--> statement-breakpoint
CREATE TABLE `media_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`remaining` integer,
	`limit_total` integer,
	`reset_at` text,
	`consecutive_failures` integer DEFAULT 0,
	`last_failure_at` text,
	`circuit_open_until` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `media_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_rate_limits_account` ON `media_rate_limits` (`account_id`);