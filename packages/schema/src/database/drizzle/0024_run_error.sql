-- #160: `pipeline_run.error` — human-readable failure reason stamped
-- when a run is driven to `failed` (deploy_stage / rollback_run errors).
--
-- Hand-written ALTER migration: per the project convention documented in
-- AGENTS.md, hand-written ALTERs don't produce a paired drizzle snapshot.
-- `_journal.json` is the source of truth for what applies; run
-- `bunx drizzle-kit generate` after the next schema change to reconcile
-- the snapshot chain.
ALTER TABLE `pipeline_run` ADD `error` text;
