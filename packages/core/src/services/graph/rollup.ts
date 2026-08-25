import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { sql } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { ancestors } from "./graph.js";

/**
 * task_rollup maintenance (task A2.3). `refresh_one` always recomputes a
 * single row from scratch via aggregate queries against the live `task`
 * table — never an incremental delta — so it's correct regardless of what
 * changed (create, reparent, complete, reopen, or a corrupted starting
 * value); the caller just has to call it for the right set of nodes.
 */
async function refresh_one(db: Database, task_id: string): Promise<void> {
	await db.run(sql`
		INSERT INTO task_rollup (task_id, direct_done, direct_total, subtree_done, subtree_total)
		VALUES (
			${task_id},
			(SELECT COUNT(*) FROM task c WHERE c.parent_id = ${task_id} AND c.deleted = 0 AND c.progress = 'COMPLETED'),
			(SELECT COUNT(*) FROM task c WHERE c.parent_id = ${task_id} AND c.deleted = 0),
			(
				WITH RECURSIVE descendants(id) AS (
					SELECT id FROM task WHERE parent_id = ${task_id} AND deleted = 0
					UNION ALL
					SELECT t.id FROM task t JOIN descendants d ON t.parent_id = d.id WHERE t.deleted = 0
				)
				SELECT COUNT(*) FROM task WHERE id IN (SELECT id FROM descendants) AND progress = 'COMPLETED'
			),
			(
				WITH RECURSIVE descendants(id) AS (
					SELECT id FROM task WHERE parent_id = ${task_id} AND deleted = 0
					UNION ALL
					SELECT t.id FROM task t JOIN descendants d ON t.parent_id = d.id WHERE t.deleted = 0
				)
				SELECT COUNT(*) FROM descendants
			)
		)
		ON CONFLICT (task_id) DO UPDATE SET
			direct_done = excluded.direct_done,
			direct_total = excluded.direct_total,
			subtree_done = excluded.subtree_done,
			subtree_total = excluded.subtree_total
	`);
}

/**
 * Refreshes `task_id`'s own rollup row plus every ancestor's, up to the
 * root. Callers pass the PARENT of whatever just changed (a completion, a
 * reparent's old/new parent, a fresh create) — `null` is a no-op (root-level
 * change, nothing above it to refresh). Safe to call unconditionally inside
 * the same `run_atomic` scope as the triggering write: every row is
 * recomputed from the live `task` table's current state, so call-order
 * relative to OTHER refreshes never matters, only relative to the write
 * itself (must run after it).
 */
export async function refresh_rollup_chain(db: Database, task_id: string | null): Promise<Result<void, ServiceError>> {
	if (task_id == null) return ok(undefined);
	await refresh_one(db, task_id);
	const chain = await ancestors(db, task_id);
	if (chain.ok) {
		for (const ancestor of chain.value) {
			await refresh_one(db, ancestor.id);
		}
	}
	return ok(undefined);
}

/**
 * Full from-scratch rebuild for every non-deleted task in a project — the
 * sweeper's drift-repair path and the v2.4 migration's rollup backfill
 * consumer. Converges an arbitrarily corrupted cache in one pass since
 * every row is independently recomputed, not patched.
 */
export async function rebuild_rollup(db: Database, project_id: string): Promise<Result<void, ServiceError>> {
	const rows = await db.all<{ id: string }>(sql`SELECT id FROM task WHERE project_id = ${project_id} AND deleted = 0`);
	for (const row of rows) {
		await refresh_one(db, row.id);
	}
	return ok(undefined);
}
