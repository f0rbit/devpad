ALTER TABLE action ADD `deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE api_key ADD `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;--> statement-breakpoint
ALTER TABLE api_key ADD `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;--> statement-breakpoint
ALTER TABLE api_key ADD `deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE checklist_item ADD `created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;--> statement-breakpoint
ALTER TABLE checklist_item ADD `updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL;--> statement-breakpoint
ALTER TABLE checklist_item ADD `deleted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE task ADD `deleted` integer DEFAULT false NOT NULL;