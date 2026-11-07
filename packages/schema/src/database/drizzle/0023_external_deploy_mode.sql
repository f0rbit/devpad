PRAGMA defer_foreign_keys = on;
--> statement-breakpoint
ALTER TABLE `pipeline_package` ADD `deploy_mode` text DEFAULT 'orchestrated' NOT NULL;
--> statement-breakpoint
ALTER TABLE `pipeline_package` ADD `external_target` text;
--> statement-breakpoint
CREATE TABLE `__new_pipeline_run` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`package_id` text NOT NULL,
	`version_set_id` text,
	`commit_sha` text,
	`shape` text NOT NULL,
	`kind` text DEFAULT 'deploy' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`current_stage` text,
	`resolved_rollout` text NOT NULL,
	`resolved_gates` text NOT NULL,
	`forced_atomic_reason` text,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`package_id`) REFERENCES `pipeline_package`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pipeline_run` (`id`,`created_at`,`updated_at`,`deleted`,`created_by`,`modified_by`,`protected`,`package_id`,`version_set_id`,`shape`,`kind`,`status`,`current_stage`,`resolved_rollout`,`resolved_gates`,`forced_atomic_reason`,`started_at`,`finished_at`) SELECT `id`,`created_at`,`updated_at`,`deleted`,`created_by`,`modified_by`,`protected`,`package_id`,`version_set_id`,`shape`,`kind`,`status`,`current_stage`,`resolved_rollout`,`resolved_gates`,`forced_atomic_reason`,`started_at`,`finished_at` FROM `pipeline_run`;
--> statement-breakpoint
CREATE TABLE `__tmp_pipeline_stage_event` AS SELECT * FROM `pipeline_stage_event`;
--> statement-breakpoint
CREATE TABLE `__tmp_pipeline_approval` AS SELECT * FROM `pipeline_approval`;
--> statement-breakpoint
DROP TABLE `pipeline_stage_event`;
--> statement-breakpoint
DROP TABLE `pipeline_approval`;
--> statement-breakpoint
DROP TABLE `pipeline_run`;
--> statement-breakpoint
ALTER TABLE `__new_pipeline_run` RENAME TO `pipeline_run`;
--> statement-breakpoint
CREATE TABLE `pipeline_stage_event` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage_name` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`ts` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`idempotency_hash` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `pipeline_stage_event` (`id`,`run_id`,`stage_name`,`kind`,`payload`,`ts`,`idempotency_hash`) SELECT `id`,`run_id`,`stage_name`,`kind`,`payload`,`ts`,`idempotency_hash` FROM `__tmp_pipeline_stage_event`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pipeline_stage_event_idem_uniq` ON `pipeline_stage_event` (`run_id`,`idempotency_hash`) WHERE `idempotency_hash` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `pipeline_approval` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage_name` text NOT NULL,
	`decision` text,
	`reason` text,
	`decided_by` text,
	`decided_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `pipeline_approval` (`id`,`run_id`,`stage_name`,`decision`,`reason`,`decided_by`,`decided_at`,`created_at`,`updated_at`) SELECT `id`,`run_id`,`stage_name`,`decision`,`reason`,`decided_by`,`decided_at`,`created_at`,`updated_at` FROM `__tmp_pipeline_approval`;
--> statement-breakpoint
DROP TABLE `__tmp_pipeline_stage_event`;
--> statement-breakpoint
DROP TABLE `__tmp_pipeline_approval`;
--> statement-breakpoint
CREATE TABLE `pipeline_dispatch` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`run_id` text NOT NULL,
	`stage_name` text NOT NULL,
	`commit_sha` text NOT NULL,
	`status` text DEFAULT 'claimed' NOT NULL,
	`error` text,
	`requested_by` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_dispatch_run_stage_unique` ON `pipeline_dispatch` (`run_id`,`stage_name`);
