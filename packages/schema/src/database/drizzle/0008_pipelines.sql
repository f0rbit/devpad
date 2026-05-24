CREATE TABLE `pipeline_analysis_template` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`query_dsl` text NOT NULL,
	`threshold_dsl` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
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
CREATE TABLE `pipeline_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`package_id` text NOT NULL,
	`stage_name` text NOT NULL,
	`scope` text NOT NULL,
	`granted_by` text,
	`granted_at` text,
	FOREIGN KEY (`package_id`) REFERENCES `pipeline_package`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pipeline_package` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`repo_url` text,
	`default_template_ref` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pipeline_run` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`modified_by` text DEFAULT 'user' NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`package_id` text NOT NULL,
	`version_set_id` text NOT NULL,
	`shape` text NOT NULL,
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
CREATE TABLE `pipeline_stage_event` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage_name` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`ts` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_run`(`id`) ON UPDATE no action ON DELETE no action
);
