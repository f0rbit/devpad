-- #155: policy-table auto-approved grants have no human grantor.
-- `pipeline_grant.granted_by` carries a FOREIGN KEY to `user(id)`, so the
-- sentinel value "system:auto-approve" fails on D1 (production-only —
-- bun:sqlite tests ran with FKs OFF and never saw it). `granted_by` stays
-- NULL for auto-approvals; this flag marks the row instead.
ALTER TABLE `pipeline_grant` ADD `auto_approved` integer NOT NULL DEFAULT 0;
