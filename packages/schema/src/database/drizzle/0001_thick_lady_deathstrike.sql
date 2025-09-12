DROP INDEX IF EXISTS `project_owner_id_project_id_unique`;--> statement-breakpoint
CREATE TABLE `project_new` (
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
	`deleted` integer DEFAULT false NOT NULL,
	`link_url` text,
	`link_text` text,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL,
	`current_version` text,
	`scan_branch` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `project_new` (id, project_id, owner_id, name, description, specification, repo_url, repo_id, icon_url, status, deleted, link_url, link_text, visibility, current_version, scan_branch)
SELECT id, project_id, owner_id, name, description, specification, repo_url, repo_id, icon_url, status, deleted, link_url, link_text, visibility, current_version, scan_branch FROM `project`;--> statement-breakpoint
UPDATE `project_new` SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL;--> statement-breakpoint
DROP TABLE `project`;--> statement-breakpoint
ALTER TABLE `project_new` RENAME TO `project`;