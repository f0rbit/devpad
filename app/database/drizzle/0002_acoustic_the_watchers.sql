ALTER TABLE `task_module` RENAME COLUMN `string` TO `type`;--> statement-breakpoint
DROP INDEX IF EXISTS `task_module_task_id_string_unique`;--> statement-breakpoint
ALTER TABLE session ADD `access_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `task_module_task_id_type_unique` ON `task_module` (`task_id`,`type`);