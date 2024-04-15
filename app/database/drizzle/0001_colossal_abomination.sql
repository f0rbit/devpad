ALTER TABLE todo_updates ADD `status` text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE `todo_updates` DROP COLUMN `accepted`;