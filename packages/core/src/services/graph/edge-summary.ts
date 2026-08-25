/**
 * @module core/services/graph/edge-summary
 *
 * v2.4 B2 — carry-over from the B1 critic pass: the outline's row-level ⛓/
 * ready/⚡/stale chips need a server-computed field, not client-side
 * re-derivation of graph state. `edge_summary_for` is the batch reader
 * (mirrors `rollups_for`'s shape/style — one indexed map, D1-param-chunked
 * via `batchedQuery`, never N+1) that the tree/list wire contract embeds.
 */
import { hook, task, task_link } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { hook_trigger } from "@devpad/schema/validation";
import { ok, type Result } from "@f0rbit/corpus";
import { and, eq, ne } from "drizzle-orm";
import { batchedQuery } from "../batch.js";
import type { ServiceError } from "../errors.js";

export type EdgeSummary = {
	/** Count of alive, not-yet-completed tasks this task is blocked by (task_link kind='blocks'). */
	blocked_count: number;
	/** Same predicate `graph.ready()` uses: not completed, not future-started, no incomplete children, unblocked. */
	ready: boolean;
	/** At least one enabled hook in this task's project is subscribed to `task.completed` and its `subject_kind` selector (if any) matches. */
	hook: boolean;
	/** `completed_via === 'policy'` AND a child was added/reopened since — sticky-completion semantics went stale. */
	stale: boolean;
};

type OwnRow = {
	id: string;
	project_id: string | null;
	kind: string;
	progress: string;
	completed_via: string | null;
	start_time: string | null;
};

async function blocked_counts_for(db: Database, task_ids: string[]): Promise<Record<string, number>> {
	const rows = await batchedQuery<{ dst_id: string | null }>(
		task_ids,
		(condition) =>
			db
				.select({ dst_id: task_link.dst_id })
				.from(task_link)
				.innerJoin(task, eq(task.id, task_link.src_id))
				.where(
					and(
						condition,
						eq(task_link.kind, "blocks"),
						eq(task_link.deleted, false),
						eq(task.deleted, false),
						ne(task.progress, "COMPLETED"),
					),
				),
		task_link.dst_id,
	);
	const counts: Record<string, number> = {};
	for (const row of rows) {
		if (!row.dst_id) continue;
		counts[row.dst_id] = (counts[row.dst_id] ?? 0) + 1;
	}
	return counts;
}

/** Ids among `task_ids` that currently have at least one alive, incomplete direct child — feeds both `ready` and `stale`. */
async function ids_with_incomplete_children(db: Database, task_ids: string[]): Promise<Set<string>> {
	const rows = await batchedQuery<{ parent_id: string | null }>(
		task_ids,
		(condition) =>
			db
				.select({ parent_id: task.parent_id })
				.from(task)
				.where(and(condition, eq(task.deleted, false), ne(task.progress, "COMPLETED"))),
		task.parent_id,
	);
	return new Set(rows.map((r) => r.parent_id).filter((id): id is string => id != null));
}

/**
 * Ids among `own_rows` with an enabled `task.completed` hook whose
 * `subject_kind` selector (if set) matches the task's kind. A UI hint, not
 * the real dispatcher: `tag`/`ancestor_id` selectors are deliberately NOT
 * matched here (would need a per-task tag join / ancestor walk for every row
 * in a tree view) — a hook scoped that way can under-report this chip, never
 * over-report. Real dispatch (`hooks/dispatch.ts`) still honors every
 * selector field correctly; this only feeds a "something's subscribed" hint.
 */
async function hook_subscribed_ids(db: Database, own_rows: OwnRow[]): Promise<Set<string>> {
	const project_ids = [...new Set(own_rows.map((r) => r.project_id).filter((id): id is string => id != null))];
	if (project_ids.length === 0) return new Set();

	const hook_rows = await batchedQuery<{ project_id: string; trigger: unknown }>(
		project_ids,
		(condition) =>
			db
				.select({ project_id: hook.project_id, trigger: hook.trigger })
				.from(hook)
				.where(and(condition, eq(hook.enabled, true), eq(hook.deleted, false))),
		hook.project_id,
	);

	const selectors_by_project = new Map<string, { subject_kind?: string }[]>();
	for (const row of hook_rows) {
		const parsed = hook_trigger.safeParse(row.trigger);
		if (!parsed.success) continue;
		if (!parsed.data.kinds.includes("task.completed")) continue;
		const existing = selectors_by_project.get(row.project_id) ?? [];
		existing.push(parsed.data.selector);
		selectors_by_project.set(row.project_id, existing);
	}

	const subscribed = new Set<string>();
	for (const row of own_rows) {
		if (!row.project_id) continue;
		const selectors = selectors_by_project.get(row.project_id);
		if (!selectors) continue;
		if (selectors.some((s) => !s.subject_kind || s.subject_kind === row.kind)) subscribed.add(row.id);
	}
	return subscribed;
}

const is_ready = (row: OwnRow, blocked_count: number, has_incomplete_children: boolean, now: string): boolean => {
	if (row.progress === "COMPLETED") return false;
	if (row.start_time && row.start_time > now) return false;
	if (has_incomplete_children) return false;
	return blocked_count === 0;
};

const is_stale = (row: OwnRow, has_incomplete_children: boolean): boolean =>
	row.completed_via === "policy" && has_incomplete_children;

/** Batch-reads the edge summary for a set of task ids — single source of truth for every ⛓/ready/⚡/stale chip. */
export async function edge_summary_for(
	db: Database,
	task_ids: string[],
): Promise<Result<Partial<Record<string, EdgeSummary>>, ServiceError>> {
	if (task_ids.length === 0) return ok({});

	const own_rows = await batchedQuery<OwnRow>(
		task_ids,
		(condition) =>
			db
				.select({
					id: task.id,
					project_id: task.project_id,
					kind: task.kind,
					progress: task.progress,
					completed_via: task.completed_via,
					start_time: task.start_time,
				})
				.from(task)
				.where(condition),
		task.id,
	);

	const [blocked_counts, incomplete_children_ids, hook_ids] = await Promise.all([
		blocked_counts_for(db, task_ids),
		ids_with_incomplete_children(db, task_ids),
		hook_subscribed_ids(db, own_rows),
	]);

	const now = new Date().toISOString();
	const summary: Partial<Record<string, EdgeSummary>> = {};
	for (const row of own_rows) {
		const has_incomplete_children = incomplete_children_ids.has(row.id);
		const blocked_count = blocked_counts[row.id] ?? 0;
		summary[row.id] = {
			blocked_count,
			ready: is_ready(row, blocked_count, has_incomplete_children, now),
			hook: hook_ids.has(row.id),
			stale: is_stale(row, has_incomplete_children),
		};
	}
	return ok(summary);
}
