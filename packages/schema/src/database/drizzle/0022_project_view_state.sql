CREATE TABLE `project_view_state` (
	`project_id` text PRIMARY KEY NOT NULL,
	`layout` text NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
