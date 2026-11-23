-- #171: GitHub Actions immutable-subject support — optional trust-policy
-- id pins. When set, the token's `repository_id` / `repository_owner_id`
-- claims must match; null = no pin (existing policies unaffected).
-- These columns defend against a deleted-and-recreated repo reusing the
-- same plain `<owner>/<repo>` name.
--
-- Hand-written ALTER migration: per the project convention documented in
-- AGENTS.md, hand-written ALTERs don't produce a paired drizzle snapshot.
-- `_journal.json` is the source of truth for what applies; run
-- `bunx drizzle-kit generate` after the next schema change to reconcile
-- the snapshot chain. Journal idx 26 (idx 25 is reserved by
-- 0025_grant_auto_approved on a parallel branch).
ALTER TABLE `pipeline_oidc_trust` ADD `repository_id` text;
--> statement-breakpoint
ALTER TABLE `pipeline_oidc_trust` ADD `repository_owner_id` text;
