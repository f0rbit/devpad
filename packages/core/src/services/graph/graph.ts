import type { Task, TaskLink, UpsertTaskLink } from "@devpad/schema";
import { GRAPH_CHILDREN_CAP, GRAPH_DEPTH_CAP, task, task_link } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DatabaseError } from "../errors.js";
import { errors, type ServiceError } from "../errors.js";
import { type EmitEventInput, write_with_event } from "./outbox.js";
import { refresh_rollup_chain } from "./rollup.js";

/**
 * Graph service (task A1.3) — hierarchy/ordering guards, recursive-CTE
 * reads, computed READY, atomic claim.
 *
 * Every structural mutation here is ONE SQL statement whose WHERE clause
 * carries the full invariant (OCC rev + recursive-CTE cycle/depth/cap
 * checks) — see the plan's "Structural race serialization argument". D1's
 * single-writer SQLite core serializes statements, so there is never a
 * validate-then-write window. On a 0-row result we run READ-ONLY follow-up
 * queries purely to build a useful typed error — those reads never race the
 * write itself, which already happened atomically.
 */

export type GraphConflictError = { kind: "graph_conflict"; message: string; current: Task };
export type CycleError = { kind: "cycle_detected"; message: string };
export type DepthExceededError = { kind: "depth_exceeded"; message: string; max_depth: number };
export type ChildrenCapExceededError = { kind: "children_cap_exceeded"; message: string; max_children: number };
export type GraphError = ServiceError | GraphConflictError | CycleError | DepthExceededError | ChildrenCapExceededError;

export async function get_task_row(db: Database, id: string): Promise<Task | null> {
	const rows = await db.all<Task>(sql`SELECT * FROM task WHERE id = ${id} LIMIT 1`);
	return rows[0] ?? null;
}

/** Read-only ancestor-chain diagnosis, used only to classify a 0-row guard failure. */
async function is_ancestor(db: Database, candidate_ancestor_id: string, node_id: string): Promise<boolean> {
	const rows = await db.all<{ id: string }>(sql`
		WITH RECURSIVE anc(id) AS (
			SELECT id FROM task WHERE id = ${candidate_ancestor_id} AND deleted = 0
			UNION ALL
			SELECT t.parent_id FROM task t JOIN anc ON t.id = anc.id WHERE t.parent_id IS NOT NULL AND t.deleted = 0
		)
		SELECT id FROM anc WHERE id = ${node_id}
	`);
	return rows.length > 0;
}

async function absolute_depth(db: Database, id: string): Promise<number> {
	const rows = await db.all<{ depth: number }>(sql`
		WITH RECURSIVE anc(id, depth) AS (
			SELECT id, 0 FROM task WHERE id = ${id} AND deleted = 0
			UNION ALL
			SELECT t.parent_id, anc.depth + 1 FROM task t JOIN anc ON t.id = anc.id WHERE t.parent_id IS NOT NULL AND t.deleted = 0
		)
		SELECT MAX(depth) AS depth FROM anc
	`);
	return rows[0]?.depth ?? 0;
}

async function children_count(db: Database, parent_id: string): Promise<number> {
	const rows = await db.all<{ n: number }>(
		sql`SELECT COUNT(*) AS n FROM task WHERE parent_id = ${parent_id} AND deleted = 0`,
	);
	return rows[0]?.n ?? 0;
}

export async function set_parent(
	db: Database,
	input: { id: string; parent_id: string | null; rank: string; base_rev: number },
): Promise<Result<Task, GraphError>> {
	const { id, parent_id, rank, base_rev } = input;

	// Sticky completion (task A2.2): read the target parent BEFORE the write
	// so a post-reparent "the parent is still policy-completed" check can
	// ride in the SAME atomic write as the guarded UPDATE below — the parent's
	// own completed_via is untouched by this reparent, so reading it first is
	// safe under the single-writer model. Same reasoning for capturing the
	// OLD parent up front — its rollup needs refreshing too (task A2.3).
	const moving = await get_task_row(db, id);
	const old_parent_id = moving?.parent_id ?? null;
	const target_parent = parent_id != null ? await get_task_row(db, parent_id) : null;

	const attempt = await write_with_event(
		db,
		async (): Promise<Result<Task | null, ServiceError>> => {
			const rows = await db.all<Task>(sql`
				WITH RECURSIVE new_parent_ancestors(id, depth) AS (
					SELECT id, 0 FROM task WHERE id = ${parent_id} AND deleted = 0
					UNION ALL
					SELECT t.parent_id, a.depth + 1
					FROM task t JOIN new_parent_ancestors a ON t.id = a.id
					WHERE t.parent_id IS NOT NULL AND t.deleted = 0
				)
				UPDATE task
				SET parent_id = ${parent_id}, rank = ${rank}, rev = rev + 1, updated_at = CURRENT_TIMESTAMP
				WHERE id = ${id}
					AND rev = ${base_rev}
					AND deleted = 0
					AND (
						${parent_id} IS NULL
						OR (
							EXISTS (SELECT 1 FROM new_parent_ancestors)
							AND NOT EXISTS (SELECT 1 FROM new_parent_ancestors WHERE new_parent_ancestors.id = ${id})
							AND (SELECT COALESCE(MAX(depth), 0) FROM new_parent_ancestors) + 1 <= ${GRAPH_DEPTH_CAP}
							AND (SELECT COUNT(*) FROM task WHERE task.parent_id = ${parent_id} AND task.deleted = 0) < ${GRAPH_CHILDREN_CAP}
						)
					)
				RETURNING *
			`);
			if (rows.length !== 1) return ok(null);
			if (old_parent_id !== parent_id) {
				const old_chain_result = await refresh_rollup_chain(db, old_parent_id);
				if (!old_chain_result.ok) return old_chain_result;
				const new_chain_result = await refresh_rollup_chain(db, parent_id);
				if (!new_chain_result.ok) return new_chain_result;
			}
			return ok(rows[0]);
		},
		(updated) => {
			if (!updated) return null;
			const events: EmitEventInput[] = [
				{
					kind: "task.updated",
					subject_id: updated.id,
					project_id: updated.project_id,
					actor: "api",
					payload: { kind: "task.updated", fields: ["parent_id", "rank"] },
				},
			];
			if (target_parent && target_parent.completed_via === "policy" && updated.progress !== "COMPLETED") {
				events.push({
					kind: "node.completion_stale",
					subject_id: target_parent.id,
					project_id: target_parent.project_id,
					actor: "policy",
					payload: { kind: "node.completion_stale", child_id: updated.id },
				});
			}
			return events;
		},
	);

	if (!attempt.ok) return attempt;
	if (attempt.value) return ok(attempt.value);

	const current = await get_task_row(db, id);
	if (!current || current.deleted) return errors.notFound("task", id);
	if (current.rev !== base_rev) {
		return err({ kind: "graph_conflict", message: `Task ${id} was modified concurrently`, current });
	}
	if (parent_id != null) {
		if (await is_ancestor(db, parent_id, id)) {
			return err({ kind: "cycle_detected", message: `Reparenting ${id} under ${parent_id} would create a cycle` });
		}
		const parent_depth = await absolute_depth(db, parent_id);
		if (parent_depth + 1 > GRAPH_DEPTH_CAP) {
			return err({
				kind: "depth_exceeded",
				message: `Depth cap of ${String(GRAPH_DEPTH_CAP)} exceeded`,
				max_depth: GRAPH_DEPTH_CAP,
			});
		}
		const siblings = await children_count(db, parent_id);
		if (siblings >= GRAPH_CHILDREN_CAP) {
			return err({
				kind: "children_cap_exceeded",
				message: `Children cap of ${String(GRAPH_CHILDREN_CAP)} exceeded for parent ${parent_id}`,
				max_children: GRAPH_CHILDREN_CAP,
			});
		}
	}
	return err({ kind: "graph_conflict", message: `set_parent guard failed for task ${id}`, current });
}

export async function claim(
	db: Database,
	input: { id: string; actor: string; base_rev: number },
): Promise<Result<Task, GraphError>> {
	const { id, actor, base_rev } = input;

	const attempt = await write_with_event(
		db,
		async (): Promise<Result<Task | null, DatabaseError>> => {
			const rows = await db.all<Task>(sql`
				UPDATE task
				SET claimed_by = ${actor}, claimed_at = CURRENT_TIMESTAMP, progress = 'IN_PROGRESS', rev = rev + 1, updated_at = CURRENT_TIMESTAMP
				WHERE id = ${id} AND rev = ${base_rev} AND deleted = 0 AND claimed_by IS NULL
				RETURNING *
			`);
			return ok(rows.length === 1 ? rows[0] : null);
		},
		(updated) =>
			updated && {
				kind: "task.claimed",
				subject_id: updated.id,
				project_id: updated.project_id,
				actor: "api",
				payload: { kind: "task.claimed", actor },
			},
	);

	if (!attempt.ok) return attempt;
	if (attempt.value) return ok(attempt.value);

	const current = await get_task_row(db, id);
	if (!current || current.deleted) return errors.notFound("task", id);
	const message =
		current.claimed_by != null
			? `Task ${id} is already claimed by ${current.claimed_by}`
			: `Task ${id} was modified concurrently`;
	return err({ kind: "graph_conflict", message, current });
}

/** blocks-kind cycle guard: reject if `dst_id` already (transitively) blocks `src_id`. */
async function would_create_blocks_cycle(db: Database, src_id: string, dst_id: string): Promise<boolean> {
	const rows = await db.all<{ id: string }>(sql`
		WITH RECURSIVE reach(id) AS (
			SELECT ${dst_id} AS id
			UNION
			SELECT tl.dst_id FROM task_link tl JOIN reach r ON tl.src_id = r.id WHERE tl.kind = 'blocks' AND tl.deleted = 0
		)
		SELECT id FROM reach WHERE id = ${src_id}
	`);
	return rows.length > 0;
}

export async function add_link(db: Database, input: UpsertTaskLink): Promise<Result<TaskLink, GraphError>> {
	const { src_id, dst_id = null, kind, ref = null, note = null } = input;

	if (kind === "blocks" && dst_id != null) {
		if (src_id === dst_id) {
			return err({ kind: "cycle_detected", message: "A task cannot block itself" });
		}
		if (await would_create_blocks_cycle(db, src_id, dst_id)) {
			return err({ kind: "cycle_detected", message: `Linking ${src_id} blocks ${dst_id} would create a cycle` });
		}
	}

	const src = await get_task_row(db, src_id);
	const id = `link_${crypto.randomUUID()}`;
	return write_with_event(
		db,
		async (): Promise<Result<TaskLink, DatabaseError>> => {
			const rows = await db.all<TaskLink>(sql`
				INSERT INTO task_link (id, created_at, updated_at, deleted, created_by, modified_by, protected, src_id, dst_id, kind, ref, note)
				VALUES (${id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 'api', 'api', 0, ${src_id}, ${dst_id}, ${kind}, ${ref ? JSON.stringify(ref) : null}, ${note})
				RETURNING *
			`);
			return ok(rows[0]);
		},
		(link) => ({
			kind: "edge.created",
			subject_id: link.src_id,
			project_id: src?.project_id ?? null,
			actor: "api",
			payload: { kind: "edge.created", link_kind: link.kind, dst_id: link.dst_id },
		}),
	);
}

export async function remove_link(db: Database, id: string): Promise<Result<boolean, GraphError>> {
	const rows = await db.select().from(task_link).where(eq(task_link.id, id));
	if (rows.length === 0) return ok(true);
	const existing = rows[0];
	const src = await get_task_row(db, existing.src_id);

	return write_with_event(
		db,
		async (): Promise<Result<boolean, DatabaseError>> => {
			await db.run(sql`UPDATE task_link SET deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`);
			return ok(true);
		},
		() => ({
			kind: "edge.removed",
			subject_id: existing.src_id,
			project_id: src?.project_id ?? null,
			actor: "api",
			payload: { kind: "edge.removed", link_kind: existing.kind, dst_id: existing.dst_id },
		}),
	);
}

/** Descendants of `id` (excludes `id` itself), bounded by `depth` hops down. */
export async function subtree(
	db: Database,
	id: string,
	depth: number = GRAPH_DEPTH_CAP,
): Promise<Result<Task[], ServiceError>> {
	const rows = await db.all<Task>(sql`
		WITH RECURSIVE descendants(id, depth) AS (
			SELECT id, 0 FROM task WHERE parent_id = ${id} AND deleted = 0
			UNION ALL
			SELECT t.id, d.depth + 1
			FROM task t JOIN descendants d ON t.parent_id = d.id
			WHERE t.deleted = 0 AND d.depth < ${depth}
		)
		SELECT task.* FROM task JOIN descendants ON task.id = descendants.id
		ORDER BY descendants.depth ASC, task.rank ASC
	`);
	return ok(rows);
}

/** Ancestors of `id` (excludes `id` itself), ordered immediate-parent-first. */
export async function ancestors(db: Database, id: string): Promise<Result<Task[], ServiceError>> {
	const rows = await db.all<Task>(sql`
		WITH RECURSIVE anc(id, depth) AS (
			SELECT id, 0 FROM task WHERE id = ${id}
			UNION ALL
			SELECT t.parent_id, a.depth + 1 FROM task t JOIN anc a ON t.id = a.id WHERE t.parent_id IS NOT NULL AND t.deleted = 0
		)
		SELECT task.* FROM task JOIN anc ON task.id = anc.id
		WHERE anc.depth > 0 AND task.deleted = 0
		ORDER BY anc.depth ASC
	`);
	return ok(rows);
}

export type ReadyResult = { items: Task[]; next_cursor: string | null };

export async function ready(
	db: Database,
	input: { owner_id: string; project_id?: string; limit: number; cursor?: string },
): Promise<Result<ReadyResult, ServiceError>> {
	const { owner_id, project_id = null, limit, cursor = null } = input;
	const now = new Date().toISOString();

	const rows = await db.all<Task>(sql`
		SELECT task.* FROM task
		WHERE task.deleted = 0
			AND task.owner_id = ${owner_id}
			AND (${project_id} IS NULL OR task.project_id = ${project_id})
			AND task.progress != 'COMPLETED'
			AND (task.start_time IS NULL OR task.start_time <= ${now})
			AND (${cursor} IS NULL OR task.id > ${cursor})
			AND NOT EXISTS (
				SELECT 1 FROM task c WHERE c.parent_id = task.id AND c.deleted = 0 AND c.progress != 'COMPLETED'
			)
			AND NOT EXISTS (
				SELECT 1 FROM task_link tl JOIN task blocker ON blocker.id = tl.src_id
				WHERE tl.dst_id = task.id AND tl.kind = 'blocks' AND tl.deleted = 0
					AND blocker.deleted = 0 AND blocker.progress != 'COMPLETED'
			)
		ORDER BY task.id ASC
		LIMIT ${limit + 1}
	`);

	const has_more = rows.length > limit;
	const items = has_more ? rows.slice(0, limit) : rows;
	const next_cursor = has_more ? (items[items.length - 1]?.id ?? null) : null;
	return ok({ items, next_cursor });
}

export type NearResult = { links: TaskLink[]; tasks: Task[] };

/** depth-2 link neighborhood around `id`, plus the tasks those edges touch — includes backlinks (edges where `id` is the dst). */
export async function near(db: Database, id: string): Promise<Result<NearResult, ServiceError>> {
	const not_deleted = eq(task_link.deleted, false);
	const touches_id = or(eq(task_link.src_id, id), eq(task_link.dst_id, id));

	const hop1 = await db.select().from(task_link).where(and(not_deleted, touches_id));

	const neighbor_ids = new Set<string>();
	for (const link of hop1) {
		if (link.src_id !== id) neighbor_ids.add(link.src_id);
		if (link.dst_id && link.dst_id !== id) neighbor_ids.add(link.dst_id);
	}

	const hop2 =
		neighbor_ids.size > 0
			? await db
					.select()
					.from(task_link)
					.where(
						and(
							not_deleted,
							or(inArray(task_link.src_id, [...neighbor_ids]), inArray(task_link.dst_id, [...neighbor_ids])),
						),
					)
			: [];

	const links = [...new Map([...hop1, ...hop2].map((link) => [link.id, link])).values()];

	const task_ids = new Set<string>([id]);
	for (const link of links) {
		task_ids.add(link.src_id);
		if (link.dst_id) task_ids.add(link.dst_id);
	}

	const tasks = await db
		.select()
		.from(task)
		.where(and(eq(task.deleted, false), inArray(task.id, [...task_ids])));

	return ok({ links, tasks });
}
