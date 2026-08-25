import type { CompletedVia, Task, TaskEvent, TaskEventActor } from "@devpad/schema";
import { GRAPH_DEPTH_CAP } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { sql } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { run_atomic } from "./atomic.js";
import { get_task_row, type GraphConflictError } from "./graph.js";
import { children_all_done, emit_event } from "./outbox.js";
import { refresh_rollup_chain } from "./rollup.js";

/**
 * The completion engine (task A2.2) — edge-triggered guarded-UPDATE
 * cascade with sticky semantics. `CompletionEngine` is the seam: consumers
 * (routes, hooks, UI-facing services) test against `InMemoryCompletionEngine`;
 * `SqlCompletionEngine` — the guarded cascade itself — is tested ONLY
 * against real SQLite (bun:sqlite), never faked, per the plan's "Bubbling
 * test seam" architecture note.
 */

/** Never "policy" here — a caller-initiated completion is always user/api/github; cascaded parents get "policy" internally. */
export type CompletionActor = Exclude<TaskEventActor, "policy">;

export type BubbleStep = { task: Task; via: CompletedVia };
export type CompleteResult = { completed: Task; bubbled: BubbleStep[]; events: TaskEvent[] };
export type ReopenResult = { reopened: Task; events: TaskEvent[] };

export type ReopenRejectedError = { kind: "reopen_rejected"; message: string };
export type CompleteError = ServiceError | GraphConflictError;
export type ReopenError = ServiceError | GraphConflictError | ReopenRejectedError;

export type CompletionEngine = {
	complete: (id: string, actor: CompletionActor, base_rev: number) => Promise<Result<CompleteResult, CompleteError>>;
	reopen: (id: string, actor: CompletionActor) => Promise<Result<ReopenResult, ReopenError>>;
};

const via_for = (actor: CompletionActor): CompletedVia => (actor === "user" ? "user" : "api");

async function complete_leaf(
	db: Database,
	id: string,
	base_rev: number,
	via: CompletedVia,
): Promise<Task | null> {
	const rows = await db.all<Task>(sql`
		UPDATE task
		SET progress = 'COMPLETED', completed_via = ${via}, rev = rev + 1, updated_at = CURRENT_TIMESTAMP
		WHERE id = ${id} AND rev = ${base_rev} AND deleted = 0 AND progress != 'COMPLETED'
		RETURNING *
	`);
	return rows.length === 1 ? rows[0] : null;
}

/**
 * The locked cascade guard (architecture-decisions) — all four predicates
 * (not-completed, policy=auto_children, EXISTS alive children, NOT EXISTS
 * an incomplete alive child) live in the WHERE clause, evaluated atomically
 * by SQLite's single-writer core. `changes()=1` is the only success signal.
 */
async function try_cascade_parent(db: Database, parent_id: string): Promise<Task | null> {
	const rows = await db.all<Task>(sql`
		UPDATE task
		SET progress = 'COMPLETED', completed_via = 'policy', rev = rev + 1, updated_at = CURRENT_TIMESTAMP
		WHERE id = ${parent_id}
			AND deleted = 0
			AND progress != 'COMPLETED'
			AND completion_policy = 'auto_children'
			AND EXISTS (SELECT 1 FROM task c WHERE c.parent_id = task.id AND c.deleted = 0)
			AND NOT EXISTS (SELECT 1 FROM task c WHERE c.parent_id = task.id AND c.deleted = 0 AND c.progress != 'COMPLETED')
		RETURNING *
	`);
	return rows.length === 1 ? rows[0] : null;
}

export type CascadeOutcome = { bubbled: BubbleStep[]; events: TaskEvent[] };

/**
 * Walks the ancestor chain from `starting_parent_id` up, cascading
 * auto_children completions. Exported (not just an engine internal) because
 * the sweeper (task A2.4) re-runs this exact function to repair a
 * mid-cascade crash — it's idempotent by construction: re-running it against
 * an already-fully-cascaded chain hits `all_done` on nothing (or the parent
 * is already COMPLETED, so `try_cascade_parent`'s guard never matches) and
 * performs zero writes. Callers own wrapping this in `run_atomic` themselves
 * (the engine wraps one leaf-completion call; the sweeper wraps a whole
 * sweep of many).
 */
export async function cascade_from(
	db: Database,
	starting_parent_id: string | null,
): Promise<Result<CascadeOutcome, CompleteError>> {
	const bubbled: BubbleStep[] = [];
	const events: TaskEvent[] = [];
	let cursor_parent_id = starting_parent_id;
	let hops = 0;

	while (cursor_parent_id && hops < GRAPH_DEPTH_CAP) {
		hops++;
		const parent_rows = await db.all<Task>(sql`SELECT * FROM task WHERE id = ${cursor_parent_id} AND deleted = 0`);
		if (parent_rows.length === 0) break;
		const parent = parent_rows[0];
		if (parent.progress === "COMPLETED") break;

		const sibling_rows = await db.all<{ deleted: number; progress: string }>(
			sql`SELECT deleted, progress FROM task WHERE parent_id = ${parent.id} AND deleted = 0`,
		);
		const all_done = children_all_done(sibling_rows.map((s) => ({ deleted: s.deleted !== 0, progress: s.progress })));
		if (!all_done) break;

		const stale_check_event = await emit_event(db, {
			kind: "node.children_all_done",
			subject_id: parent.id,
			project_id: parent.project_id,
			actor: "policy",
			payload: { kind: "node.children_all_done" },
		});
		if (!stale_check_event.ok) return stale_check_event;
		events.push(stale_check_event.value);

		if (parent.completion_policy !== "auto_children") break;

		const cascaded = await try_cascade_parent(db, parent.id);
		if (!cascaded) break;

		const policy_event = await emit_event(db, {
			kind: "policy.fired",
			subject_id: cascaded.id,
			project_id: cascaded.project_id,
			actor: "policy",
			payload: { kind: "policy.fired", policy: "auto_children" },
		});
		if (!policy_event.ok) return policy_event;
		events.push(policy_event.value);

		const cascaded_completed_event = await emit_event(db, {
			kind: "task.completed",
			subject_id: cascaded.id,
			project_id: cascaded.project_id,
			actor: "policy",
			payload: { kind: "task.completed", via: "policy" },
		});
		if (!cascaded_completed_event.ok) return cascaded_completed_event;
		events.push(cascaded_completed_event.value);

		bubbled.push({ task: cascaded, via: "policy" });
		cursor_parent_id = cascaded.parent_id;
	}

	return ok({ bubbled, events });
}

export class SqlCompletionEngine implements CompletionEngine {
	constructor(private readonly db: Database) {}

	async complete(id: string, actor: CompletionActor, base_rev: number): Promise<Result<CompleteResult, CompleteError>> {
		const db = this.db;
		return run_atomic(db, async (): Promise<Result<CompleteResult, CompleteError>> => {
			const via = via_for(actor);
			const completed = await complete_leaf(db, id, base_rev, via);
			if (!completed) {
				const current = await get_task_row(db, id);
				if (!current || current.deleted) return errors.notFound("task", id);
				if (current.progress === "COMPLETED") {
					return err({ kind: "graph_conflict", message: `Task ${id} is already completed`, current });
				}
				return err({ kind: "graph_conflict", message: `Task ${id} was modified concurrently`, current });
			}

			const events: TaskEvent[] = [];
			const completed_event = await emit_event(db, {
				kind: "task.completed",
				subject_id: completed.id,
				project_id: completed.project_id,
				actor,
				payload: { kind: "task.completed", via },
			});
			if (!completed_event.ok) return completed_event;
			events.push(completed_event.value);

			const cascade_result = await cascade_from(db, completed.parent_id);
			if (!cascade_result.ok) return cascade_result;
			events.push(...cascade_result.value.events);

			// One refresh covers the whole chain (task A2.3): `refresh_rollup_chain`
			// recomputes every ancestor from the CURRENT `task` table state, so a
			// single call from the leaf's immediate parent after every cascade
			// UPDATE has already committed picks up every hop, not just the first.
			const rollup_result = await refresh_rollup_chain(db, completed.parent_id);
			if (!rollup_result.ok) return rollup_result;

			return ok({ completed, bubbled: cascade_result.value.bubbled, events });
		});
	}

	async reopen(id: string, actor: CompletionActor): Promise<Result<ReopenResult, ReopenError>> {
		const db = this.db;
		return run_atomic(db, async (): Promise<Result<ReopenResult, ReopenError>> => {
			const current = await get_task_row(db, id);
			if (!current || current.deleted) return errors.notFound("task", id);
			if (current.completed_via !== "policy") {
				return err({
					kind: "reopen_rejected",
					message: `Task ${id} was not policy-completed (completed_via=${String(current.completed_via)}); only policy completions can be reopened`,
				});
			}

			const rows = await db.all<Task>(sql`
				UPDATE task
				SET progress = 'IN_PROGRESS', completed_via = NULL, rev = rev + 1, updated_at = CURRENT_TIMESTAMP
				WHERE id = ${id} AND deleted = 0 AND progress = 'COMPLETED' AND completed_via = 'policy'
				RETURNING *
			`);
			if (rows.length !== 1) {
				return err({ kind: "graph_conflict", message: `Task ${id} was modified concurrently`, current });
			}
			const reopened = rows[0];

			const event = await emit_event(db, {
				kind: "task.reopened",
				subject_id: reopened.id,
				project_id: reopened.project_id,
				actor,
				payload: { kind: "task.reopened", via: "policy" },
			});
			if (!event.ok) return event;

			const rollup_result = await refresh_rollup_chain(db, reopened.parent_id);
			if (!rollup_result.ok) return rollup_result;

			return ok({ reopened, events: [event.value] });
		});
	}
}
