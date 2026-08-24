import type { ApplyOp, ApplyRequest, ExternalRef, UpsertTodo } from "@devpad/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { sql } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { run_atomic } from "./atomic.js";
import { add_link, claim, type GraphError, get_task_row, remove_link, set_parent } from "./graph.js";

export type ApplyOpResult = { op: ApplyOp["op"]; id: string };
export type ApplyResponse = { idempotency_key: string; results: ApplyOpResult[] };
export type ApplyOpFailedError = { kind: "apply_op_failed"; op_index: number; error: GraphError };
export type ApplyError = ServiceError | GraphError | ApplyOpFailedError;

/** `$0`, `$1`, … resolve to the id the create-op at that index produced. */
function resolve_handle(value: string | null, handles: Map<string, string>): string | null {
	if (value == null) return null;
	return handles.get(value) ?? value;
}

async function insert_task_row(db: Database, id: string, data: UpsertTodo, owner_id: string): Promise<void> {
	const now = new Date().toISOString();
	await db.run(sql`
		INSERT INTO task (
			id, owner_id, title, progress, visibility, priority, parent_id, rank, rev,
			kind, completion_policy, project_id, goal_id, description, start_time, end_time, summary,
			created_at, updated_at, deleted, created_by, modified_by, protected
		) VALUES (
			${id}, ${owner_id}, ${data.title ?? "Untitled"}, ${data.progress ?? "UNSTARTED"}, ${data.visibility ?? "PRIVATE"}, ${data.priority ?? "LOW"}, ${data.parent_id ?? null}, ${data.rank ?? ""}, 0,
			${data.kind ?? "task"}, ${data.completion_policy ?? "manual"}, ${data.project_id ?? null}, ${data.goal_id ?? null}, ${data.description ?? null}, ${data.start_time ?? null}, ${data.end_time ?? null}, ${data.summary ?? null},
			${now}, ${now}, 0, 'api', 'api', 0
		)
	`);
}

async function update_task_row(
	db: Database,
	id: string,
	base_rev: number,
	data: Partial<UpsertTodo>,
): Promise<Result<void, GraphError>> {
	const current = await get_task_row(db, id);
	if (!current || current.deleted) return errors.notFound("task", id);
	if (current.rev !== base_rev) {
		return err({ kind: "graph_conflict", message: `Task ${id} was modified concurrently`, current });
	}

	const rows = await db.all<{ id: string }>(sql`
		UPDATE task SET
			title = ${data.title ?? current.title},
			description = ${data.description ?? current.description},
			summary = ${data.summary ?? current.summary},
			priority = ${data.priority ?? current.priority},
			visibility = ${data.visibility ?? current.visibility},
			rev = rev + 1,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = ${id} AND rev = ${base_rev} AND deleted = 0
		RETURNING id
	`);
	if (rows.length !== 1)
		return err({ kind: "graph_conflict", message: `Task ${id} was modified concurrently`, current });
	return ok(undefined);
}

async function complete_task_row(db: Database, id: string, base_rev: number): Promise<Result<void, GraphError>> {
	const rows = await db.all<{ id: string }>(sql`
		UPDATE task SET progress = 'COMPLETED', completed_via = 'api', rev = rev + 1, updated_at = CURRENT_TIMESTAMP
		WHERE id = ${id} AND rev = ${base_rev} AND deleted = 0
		RETURNING id
	`);
	if (rows.length === 1) return ok(undefined);

	const current = await get_task_row(db, id);
	if (!current || current.deleted) return errors.notFound("task", id);
	return err({ kind: "graph_conflict", message: `Task ${id} was modified concurrently`, current });
}

async function execute_op(
	db: Database,
	op: ApplyOp,
	index: number,
	owner_id: string,
	handles: Map<string, string>,
): Promise<Result<ApplyOpResult, GraphError>> {
	switch (op.op) {
		case "create": {
			const id = handles.get(`$${String(index)}`)!;
			const data: UpsertTodo = { ...op.data, parent_id: resolve_handle(op.data.parent_id ?? null, handles) };
			await insert_task_row(db, id, data, owner_id);
			return ok({ op: op.op, id });
		}
		case "update": {
			const id = resolve_handle(op.id, handles)!;
			const result = await update_task_row(db, id, op.base_rev, op.data);
			return result.ok ? ok({ op: op.op, id }) : result;
		}
		case "reparent": {
			const id = resolve_handle(op.id, handles)!;
			const parent_id = resolve_handle(op.parent_id, handles);
			const result = await set_parent(db, { id, parent_id, rank: "i0", base_rev: op.base_rev });
			return result.ok ? ok({ op: op.op, id }) : result;
		}
		case "link": {
			const src_id = resolve_handle(op.link.src_id, handles)!;
			const dst_id = resolve_handle(op.link.dst_id ?? null, handles);
			const result = await add_link(db, {
				...op.link,
				src_id,
				dst_id,
				ref: op.link.ref as ExternalRef | null | undefined,
			});
			return result.ok ? ok({ op: op.op, id: result.value.id }) : result;
		}
		case "unlink": {
			const id = resolve_handle(op.id, handles)!;
			const result = await remove_link(db, id);
			return result.ok ? ok({ op: op.op, id }) : result;
		}
		case "claim": {
			const id = resolve_handle(op.id, handles)!;
			const result = await claim(db, { id, actor: op.actor, base_rev: op.base_rev });
			return result.ok ? ok({ op: op.op, id }) : result;
		}
		case "complete": {
			const id = resolve_handle(op.id, handles)!;
			const result = await complete_task_row(db, id, op.base_rev);
			return result.ok ? ok({ op: op.op, id }) : result;
		}
	}
}

/**
 * Batch apply (task A1.4). `ops` are executed in order, atomically — any op
 * failure aborts the whole batch (including previously-applied ops in this
 * same call). `$0`/`$1`… temp handles let a `create` op earlier in the batch
 * be referenced (as a parent, link endpoint, or claim/complete target) by a
 * later op, so one call can create a whole subtree. Replaying the same
 * `idempotency_key` for the same owner returns the stored response verbatim
 * without re-executing anything.
 */
export async function apply(
	db: Database,
	input: ApplyRequest,
	ctx: { owner_id: string },
): Promise<Result<ApplyResponse, ApplyError>> {
	const existing = await db.all<{ response: string }>(
		sql`SELECT response FROM apply_log WHERE idempotency_key = ${input.idempotency_key} AND owner_id = ${ctx.owner_id} LIMIT 1`,
	);
	const stored = existing[0];
	if (stored) return ok(JSON.parse(stored.response) as ApplyResponse);

	const handles = new Map<string, string>();
	input.ops.forEach((op, i) => {
		if (op.op !== "create") return;
		const id = `task_${crypto.randomUUID()}`;
		handles.set(`$${String(i)}`, id);
		if (op.handle) handles.set(op.handle, id);
	});

	return run_atomic(db, async (): Promise<Result<ApplyResponse, ApplyError>> => {
		const results: ApplyOpResult[] = [];
		for (let i = 0; i < input.ops.length; i++) {
			const op = input.ops[i]!;
			const outcome = await execute_op(db, op, i, ctx.owner_id, handles);
			if (!outcome.ok) return err({ kind: "apply_op_failed", op_index: i, error: outcome.error });
			results.push(outcome.value);
		}

		const response: ApplyResponse = { idempotency_key: input.idempotency_key, results };
		await db.run(sql`
			INSERT INTO apply_log (idempotency_key, owner_id, response, created_at)
			VALUES (${input.idempotency_key}, ${ctx.owner_id}, ${JSON.stringify(response)}, CURRENT_TIMESTAMP)
		`);
		return ok(response);
	});
}
