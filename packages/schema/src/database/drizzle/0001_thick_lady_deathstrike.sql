DROP INDEX IF EXISTS `project_owner_id_project_id_unique`;--> statement-breakpoint
ALTER TABLE project ADD `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;--> statement-breakpoint
ALTER TABLE project ADD `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;