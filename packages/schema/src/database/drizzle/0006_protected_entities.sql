ALTER TABLE `action` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `checklist` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `checklist_item` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `codebase_tasks` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `goal` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `milestone` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tag` ADD `protected` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `task` ADD `protected` integer DEFAULT false NOT NULL;