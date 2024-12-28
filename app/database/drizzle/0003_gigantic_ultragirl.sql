ALTER TABLE codebase_tasks ADD `commit_sha` text;--> statement-breakpoint
ALTER TABLE codebase_tasks ADD `commit_msg` text;--> statement-breakpoint
ALTER TABLE todo_updates ADD `branch` text;--> statement-breakpoint
ALTER TABLE todo_updates ADD `commit_sha` text;--> statement-breakpoint
ALTER TABLE todo_updates ADD `commit_msg` text;--> statement-breakpoint
ALTER TABLE `codebase_tasks` DROP COLUMN `commit`;