-- v2.4 (task A5.1) — milestone/goal fold data backfill.
--
-- Hand-written SQL is the plan's documented, sanctioned exception to the
-- "never hand-write SQL/migrations" rule (drizzle-kit cannot generate data
-- transforms). It travels the exact same path as every other migration —
-- committed here, journal-registered, applied ONLY by CI's
-- `wrangler d1 migrations apply` — never hand-applied.
--
-- Every statement is additive (INSERT, or UPDATE of the `task.parent_id`/
-- `task.rank` columns A1 already added) — the frozen `milestone`/`goal`
-- tables are never written to, matching the plan's rollback note ("rolling
-- back = reverting the services PR; frozen source tables remain intact").
-- Every INSERT is guarded (`WHERE NOT EXISTS`) so re-applying against an
-- already-folded DB is a no-op, and safe against a DB with zero legacy rows.
--
-- Orphan handling: a goal whose `milestone_id` doesn't resolve to a real
-- milestone is silently skipped (the INNER JOIN drops it — no crash, no
-- fabricated project association). A task whose `goal_id` doesn't resolve to
-- a migrated goal keeps its existing `parent_id` untouched (never pointed at
-- a dangling id).
--
-- Rank backfill note: ranks are normally ONLY ever produced by
-- `rank_between()` (see `packages/core/src/services/graph/rank.ts` — "never
-- hand-construct a rank string"). This migration is the one sanctioned
-- exception: it emits well-formed self-headed keys (a fixed head digit +
-- a fixed-width zero-padded decimal body, `'r' || printf('%010d', n)`) that
-- `rank_between`'s own grammar parses identically to a real generated key of
-- that magnitude (decimal digits are the low end of the same base-36
-- alphabet), so future inserts between backfilled siblings behave correctly.
--
-- Milestones → task rows (kind='milestone', parent_id=NULL). `target_version`
-- has no task column of its own — it rides in the otherwise-unused `summary`
-- free-text field (documented compat-projection detail, see AGENTS.md).
-- Rank reflects the `after_id` chain: independent chains ("heads": after_id
-- NULL or pointing outside the project) are spaced 100000 apart so any
-- single chain (up to 100000 hops) can never collide with the next chain's
-- numbering; a bounded depth guard (10000 hops) prevents a pathological
-- after_id cycle from hanging the migration, and `MIN(position)` collapses
-- any such cycle's duplicate derivations to one deterministic value.
WITH RECURSIVE ms_heads(id, project_id, position, depth) AS (
	SELECT
		m.id,
		m.project_id,
		(ROW_NUMBER() OVER (PARTITION BY m.project_id ORDER BY m.created_at, m.rowid) - 1) * 100000,
		0
	FROM milestone m
	WHERE m.after_id IS NULL
		OR NOT EXISTS (SELECT 1 FROM milestone m2 WHERE m2.id = m.after_id AND m2.project_id = m.project_id)
	UNION ALL
	SELECT m.id, m.project_id, ms_heads.position + 1, ms_heads.depth + 1
	FROM milestone m
	JOIN ms_heads ON m.after_id = ms_heads.id
	WHERE ms_heads.depth < 10000
),
ms_order(id, position) AS (
	SELECT id, MIN(position) FROM ms_heads GROUP BY id
)
INSERT INTO task (
	id, owner_id, title, progress, visibility, goal_id, project_id, description,
	start_time, end_time, summary, codebase_task_id, priority, parent_id, rank, rev,
	kind, completion_policy, completed_via, claimed_by, claimed_at, stage,
	created_at, updated_at, deleted, created_by, modified_by, protected
)
SELECT
	m.id,
	p.owner_id,
	m.name,
	CASE WHEN m.finished_at IS NOT NULL THEN 'COMPLETED' ELSE 'UNSTARTED' END,
	'PRIVATE',
	NULL,
	m.project_id,
	m.description,
	NULL,
	m.target_time,
	m.target_version,
	NULL,
	'LOW',
	NULL,
	'r' || printf('%010d', COALESCE((SELECT position FROM ms_order WHERE ms_order.id = m.id), 0)),
	0,
	'milestone',
	'auto_children',
	CASE WHEN m.finished_at IS NOT NULL THEN 'user' ELSE NULL END,
	NULL,
	NULL,
	NULL,
	m.created_at,
	m.updated_at,
	m.deleted,
	m.created_by,
	m.modified_by,
	m.protected
FROM milestone m
JOIN project p ON p.id = m.project_id
WHERE NOT EXISTS (SELECT 1 FROM task t WHERE t.id = m.id);
--> statement-breakpoint

-- Goals → task rows (kind='goal', parent_id=milestone_id). Orphan handling:
-- INNER JOINs drop a goal whose milestone is missing, or whose milestone
-- failed to migrate above (e.g. a milestone with no resolvable project).
-- Rank is sequential by created_at within the milestone — goals never had an
-- `after_id`-style ordering concept in the frozen table (`getMilestoneGoals`
-- only ever sorted by `created_at DESC`), so there is no chain to preserve.
WITH goal_order(id, position) AS (
	SELECT g.id, ROW_NUMBER() OVER (PARTITION BY g.milestone_id ORDER BY g.created_at, g.rowid) - 1
	FROM goal g
)
INSERT INTO task (
	id, owner_id, title, progress, visibility, goal_id, project_id, description,
	start_time, end_time, summary, codebase_task_id, priority, parent_id, rank, rev,
	kind, completion_policy, completed_via, claimed_by, claimed_at, stage,
	created_at, updated_at, deleted, created_by, modified_by, protected
)
SELECT
	g.id,
	p.owner_id,
	g.name,
	CASE WHEN g.finished_at IS NOT NULL THEN 'COMPLETED' ELSE 'UNSTARTED' END,
	'PRIVATE',
	NULL,
	m.project_id,
	g.description,
	NULL,
	g.target_time,
	NULL,
	NULL,
	'LOW',
	g.milestone_id,
	'r' || printf('%010d', COALESCE((SELECT position FROM goal_order WHERE goal_order.id = g.id), 0)),
	0,
	'goal',
	'manual',
	CASE WHEN g.finished_at IS NOT NULL THEN 'user' ELSE NULL END,
	NULL,
	NULL,
	NULL,
	g.created_at,
	g.updated_at,
	g.deleted,
	g.created_by,
	g.modified_by,
	g.protected
FROM goal g
JOIN milestone m ON m.id = g.milestone_id
JOIN project p ON p.id = m.project_id
WHERE EXISTS (SELECT 1 FROM task t WHERE t.id = m.id AND t.kind = 'milestone')
	AND NOT EXISTS (SELECT 1 FROM task t WHERE t.id = g.id);
--> statement-breakpoint

-- Existing regular task rows: `goal_id` becomes a real graph edge
-- (`parent_id`). Orphan handling: a dangling `goal_id` (never a real goal, or
-- one that failed to migrate above) is excluded by the `IN` filter — such a
-- task's `parent_id` is left exactly as it was, never pointed at a
-- nonexistent id. Idempotent: re-running recomputes the identical
-- deterministic `parent_id`/`rank` from unchanged inputs (`goal_id`,
-- `created_at`, `rowid` never change), so a second application is a no-op.
WITH task_order(id, new_rank) AS (
	SELECT id, 'r' || printf('%010d', ROW_NUMBER() OVER (PARTITION BY goal_id ORDER BY created_at, rowid) - 1)
	FROM task
	WHERE goal_id IS NOT NULL AND goal_id IN (SELECT id FROM task WHERE kind = 'goal')
)
UPDATE task
SET parent_id = task.goal_id,
	rank = (SELECT new_rank FROM task_order WHERE task_order.id = task.id),
	updated_at = CURRENT_TIMESTAMP
WHERE goal_id IS NOT NULL AND goal_id IN (SELECT id FROM task WHERE kind = 'goal');
--> statement-breakpoint

-- Rollup rebuild for every new parent (every migrated milestone + goal),
-- mirroring `refresh_one` (`packages/core/src/services/graph/rollup.ts`).
-- `ON CONFLICT DO UPDATE` makes this idempotent by construction — a re-run
-- simply recomputes the same aggregate from the current `task` table state.
INSERT INTO task_rollup (task_id, direct_done, direct_total, subtree_done, subtree_total)
SELECT
	t.id,
	(SELECT COUNT(*) FROM task c WHERE c.parent_id = t.id AND c.deleted = 0 AND c.progress = 'COMPLETED'),
	(SELECT COUNT(*) FROM task c WHERE c.parent_id = t.id AND c.deleted = 0),
	(
		WITH RECURSIVE descendants(id) AS (
			SELECT id FROM task WHERE parent_id = t.id AND deleted = 0
			UNION ALL
			SELECT tk.id FROM task tk JOIN descendants d ON tk.parent_id = d.id WHERE tk.deleted = 0
		)
		SELECT COUNT(*) FROM task WHERE id IN (SELECT id FROM descendants) AND progress = 'COMPLETED'
	),
	(
		WITH RECURSIVE descendants(id) AS (
			SELECT id FROM task WHERE parent_id = t.id AND deleted = 0
			UNION ALL
			SELECT tk.id FROM task tk JOIN descendants d ON tk.parent_id = d.id WHERE tk.deleted = 0
		)
		SELECT COUNT(*) FROM descendants
	)
FROM task t
WHERE t.kind IN ('milestone', 'goal')
ON CONFLICT (task_id) DO UPDATE SET
	direct_done = excluded.direct_done,
	direct_total = excluded.direct_total,
	subtree_done = excluded.subtree_done,
	subtree_total = excluded.subtree_total;
