import { GRAPH_DEPTH_CAP } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { sql } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { run_atomic } from "./atomic.js";
import { cascade_from, type CompleteError } from "./completion.js";
import { needs_rebalance, rank_between } from "./rank.js";
import { rebuild_rollup, refresh_rollup_chain } from "./rollup.js";

/**
 * The cron sweeper (task A2.4) — the crash/bug backstop the "structural
 * race serialization argument" (architecture-decisions) calls for, never
 * the primary mechanism. Runs on the existing 5-min worker cron.
 */

const CASCADE_REPAIR_WINDOW_MS = 15 * 60 * 1000;

/**
 * Every graph-mutation write in this module stamps `updated_at` via raw SQL
 * `CURRENT_TIMESTAMP` (SQLite's native `YYYY-MM-DD HH:MM:SS`, UTC, no `T`/`Z`/
 * millis) — NOT `Date.prototype.toISOString()`'s format, which the older
 * (non-graph) service layer uses instead. A cutoff built with `toISOString()`
 * string-compares as always-less-than any native-format timestamp (`' '`
 * sorts below `'T'`), silently matching nothing. Format the cutoff to match.
 */
function sqlite_utc_cutoff(ms_ago: number): string {
	return new Date(Date.now() - ms_ago).toISOString().slice(0, 19).replace("T", " ");
}

export type SweepReport = {
	cascades_repaired: number;
	rollups_repaired: number;
	siblings_rebalanced: number;
	cycle_violations: number;
	depth_violations: number;
};

export type SweepError = ServiceError | CompleteError;

/**
 * Parents that SHOULD have auto-completed (a child of theirs completed
 * recently, they're `auto_children`, and every alive child is now done) but
 * haven't — the honest signature of a mid-cascade crash. Scoped to children
 * completed within the repair window so a sweep doesn't rescan the whole
 * tree; a MANUAL-policy parent that's legitimately, permanently open never
 * matches (`completion_policy != 'auto_children'` excludes it), so re-
 * running this against a healthy tree finds nothing.
 */
async function find_stale_cascade_parents(db: Database, cutoff_iso: string): Promise<string[]> {
	const rows = await db.all<{ parent_id: string }>(sql`
		SELECT DISTINCT t.parent_id AS parent_id
		FROM task t
		JOIN task p ON p.id = t.parent_id
		WHERE t.progress = 'COMPLETED'
			AND t.deleted = 0
			AND t.updated_at >= ${cutoff_iso}
			AND t.parent_id IS NOT NULL
			AND p.deleted = 0
			AND p.progress != 'COMPLETED'
			AND p.completion_policy = 'auto_children'
			AND NOT EXISTS (SELECT 1 FROM task c WHERE c.parent_id = p.id AND c.deleted = 0 AND c.progress != 'COMPLETED')
	`);
	return rows.map((r) => r.parent_id);
}

/**
 * One row's cached rollup vs a live recompute, both direct and subtree —
 * same shape `rollup.ts` writes, checked independently here. Missing
 * `task_rollup` rows default to `0`, not a sentinel like `-1`: a genuinely
 * childless task never gets a rollup row written (nothing ever calls
 * `refresh_rollup_chain` on it), and `0` is exactly its correct value —
 * treating "no row" as drift would flag every leaf task in the tree.
 */
async function project_has_rollup_drift(db: Database, project_id: string): Promise<boolean> {
	const rows = await db.all<{ n: number }>(sql`
		SELECT COUNT(*) AS n
		FROM task t
		WHERE t.project_id = ${project_id} AND t.deleted = 0
		AND (
			COALESCE((SELECT direct_total FROM task_rollup WHERE task_id = t.id), 0)
				!= (SELECT COUNT(*) FROM task c WHERE c.parent_id = t.id AND c.deleted = 0)
			OR COALESCE((SELECT direct_done FROM task_rollup WHERE task_id = t.id), 0)
				!= (SELECT COUNT(*) FROM task c WHERE c.parent_id = t.id AND c.deleted = 0 AND c.progress = 'COMPLETED')
			OR COALESCE((SELECT subtree_total FROM task_rollup WHERE task_id = t.id), 0)
				!= (
					WITH RECURSIVE descendants(id) AS (
						SELECT id FROM task WHERE parent_id = t.id AND deleted = 0
						UNION ALL
						SELECT tt.id FROM task tt JOIN descendants d ON tt.parent_id = d.id WHERE tt.deleted = 0
					)
					SELECT COUNT(*) FROM descendants
				)
			OR COALESCE((SELECT subtree_done FROM task_rollup WHERE task_id = t.id), 0)
				!= (
					WITH RECURSIVE descendants(id) AS (
						SELECT id FROM task WHERE parent_id = t.id AND deleted = 0
						UNION ALL
						SELECT tt.id FROM task tt JOIN descendants d ON tt.parent_id = d.id WHERE tt.deleted = 0
					)
					SELECT COUNT(*) FROM task WHERE id IN (SELECT id FROM descendants) AND progress = 'COMPLETED'
				)
		)
	`);
	return (rows[0]?.n ?? 0) > 0;
}

/** Sampled to projects touched within the repair window, not every project — bounds sweep cost to recent activity. */
async function repair_drifted_rollups(db: Database, cutoff_iso: string): Promise<Result<number, ServiceError>> {
	const project_rows = await db.all<{ project_id: string }>(sql`
		SELECT DISTINCT project_id FROM task WHERE deleted = 0 AND project_id IS NOT NULL AND updated_at >= ${cutoff_iso}
	`);

	let repaired = 0;
	for (const { project_id } of project_rows) {
		if (await project_has_rollup_drift(db, project_id)) {
			const rebuild_result = await rebuild_rollup(db, project_id);
			if (!rebuild_result.ok) return rebuild_result;
			repaired++;
		}
	}
	return ok(repaired);
}

/** Cycle-free + depth ≤ cap, verified (not auto-corrected — there's no safe automatic fix for a cycle). */
async function verify_structural_invariants(
	db: Database,
): Promise<{ cycle_violations: number; depth_violations: number }> {
	const rows = await db.all<{ id: string; parent_id: string | null }>(
		sql`SELECT id, parent_id FROM task WHERE deleted = 0`,
	);
	const parent_of = new Map<string, string | null>();
	for (const row of rows) parent_of.set(row.id, row.parent_id);

	let cycle_violations = 0;
	let depth_violations = 0;
	const max_hops = parent_of.size + 1;

	for (const id of parent_of.keys()) {
		const visited = new Set<string>();
		let cursor: string | null = id;
		let depth = 0;
		let cyclic = false;
		while (cursor != null) {
			if (visited.has(cursor)) {
				cyclic = true;
				break;
			}
			visited.add(cursor);
			cursor = parent_of.get(cursor) ?? null;
			depth++;
			if (depth > max_hops) {
				cyclic = true;
				break;
			}
		}
		if (cyclic) {
			cycle_violations++;
			continue;
		}
		if (depth > GRAPH_DEPTH_CAP) depth_violations++;
	}

	return { cycle_violations, depth_violations };
}

/**
 * Re-lays a sibling set's ranks sequentially via `rank_between` — a
 * multi-row write, so every UPDATE carries its own `rev` guard and the
 * whole set moves through one caller-provided `run_atomic` scope.
 */
async function rebalance_sibling_set(
	db: Database,
	siblings: { id: string; rank: string; rev: number }[],
): Promise<number> {
	if (!needs_rebalance(siblings.map((s) => s.rank))) return 0;
	let prev: string | null = null;
	let rebalanced = 0;
	for (const sibling of siblings) {
		const new_rank = rank_between(prev, null);
		await db.run(sql`
			UPDATE task SET rank = ${new_rank}, rev = rev + 1, updated_at = CURRENT_TIMESTAMP
			WHERE id = ${sibling.id} AND rev = ${sibling.rev}
		`);
		prev = new_rank;
		rebalanced++;
	}
	return rebalanced;
}

/** Root-level tasks are scoped to their project for rebalancing (unrelated projects' roots are never siblings). */
function sibling_group_key(row: { parent_id: string | null; project_id: string | null }): string {
	return row.parent_id ?? `root:${row.project_id ?? ""}`;
}

async function rebalance_stale_sibling_sets(db: Database): Promise<number> {
	const rows = await db.all<{
		id: string;
		parent_id: string | null;
		project_id: string | null;
		rank: string;
		rev: number;
	}>(
		sql`SELECT id, parent_id, project_id, rank, rev FROM task WHERE deleted = 0 ORDER BY parent_id, project_id, rank ASC`,
	);

	const groups = new Map<string, typeof rows>();
	for (const row of rows) {
		const key = sibling_group_key(row);
		const group = groups.get(key);
		if (group) group.push(row);
		else groups.set(key, [row]);
	}

	let rebalanced = 0;
	for (const group of groups.values()) {
		rebalanced += await rebalance_sibling_set(db, group);
	}
	return rebalanced;
}

/**
 * One sweep: repair mid-cascade crashes, verify structural invariants,
 * repair drifted rollup caches, rebalance sibling sets whose ranks have
 * grown past the length heuristic. A clean tree performs zero writes —
 * every repair step's candidate query only matches genuinely stale state.
 */
export async function sweep_graph(db: Database): Promise<Result<SweepReport, SweepError>> {
	return run_atomic(db, async (): Promise<Result<SweepReport, SweepError>> => {
		const cutoff_iso = sqlite_utc_cutoff(CASCADE_REPAIR_WINDOW_MS);

		const stale_parents = await find_stale_cascade_parents(db, cutoff_iso);
		let cascades_repaired = 0;
		for (const parent_id of stale_parents) {
			const cascade_result = await cascade_from(db, parent_id);
			if (!cascade_result.ok) return cascade_result;
			if (cascade_result.value.events.length > 0) {
				cascades_repaired++;
				const rollup_result = await refresh_rollup_chain(db, parent_id);
				if (!rollup_result.ok) return rollup_result;
			}
		}

		const { cycle_violations, depth_violations } = await verify_structural_invariants(db);
		const rollups_repaired_result = await repair_drifted_rollups(db, cutoff_iso);
		if (!rollups_repaired_result.ok) return rollups_repaired_result;
		const rollups_repaired = rollups_repaired_result.value;
		const siblings_rebalanced = await rebalance_stale_sibling_sets(db);

		return ok({ cascades_repaired, rollups_repaired, siblings_rebalanced, cycle_violations, depth_violations });
	});
}
