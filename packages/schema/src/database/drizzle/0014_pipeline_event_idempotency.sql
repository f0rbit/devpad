ALTER TABLE `pipeline_stage_event` ADD `idempotency_hash` text;--> statement-breakpoint
CREATE INDEX `idx_pipeline_stage_event_idem` ON `pipeline_stage_event` (`run_id`,`idempotency_hash`);
