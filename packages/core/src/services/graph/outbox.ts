import type { TaskEvent, TaskEventActor, TaskEventKind, TaskEventPayload } from "@devpad/schema";
import { task_event_payload } from "@devpad/schema/validation";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { sql } from "drizzle-orm";
import type { DatabaseError, ValidationError } from "../errors.js";
import { run_atomic } from "./atomic.js";

/**
 * Transactional outbox (task A2.1) — every graph mutation pairs its state
 * change with exactly one `task_event` row, written atomically via
 * `write_with_event` (bun-sqlite: real rollback on either half failing; D1:
 * see `run_atomic`'s documented un-transacted limitation).
 */

export type EmitEventInput = {
	kind: TaskEventKind;
	subject_id: string;
	project_id: string | null;
	actor: TaskEventActor;
	payload: TaskEventPayload;
};

/** Inserts one outbox row. Rejects if `payload.kind` doesn't match `kind`, or fails its own schema. */
export async function emit_event(
	db: Database,
	input: EmitEventInput,
): Promise<Result<TaskEvent, ValidationError | DatabaseError>> {
	if (input.kind !== input.payload.kind) {
		return err({
			kind: "validation",
			message: `task_event kind '${input.kind}' does not match payload kind '${input.payload.kind}'`,
			errors: {},
		});
	}
	const parsed = task_event_payload.safeParse(input.payload);
	if (!parsed.success) {
		return err({ kind: "validation", message: parsed.error.message, errors: {} });
	}

	const event_id = `evt_${crypto.randomUUID()}`;
	const rows = await db.all<TaskEvent>(sql`
		INSERT INTO task_event (event_id, kind, subject_id, project_id, actor, payload, occurred_at, dispatch_status)
		VALUES (${event_id}, ${input.kind}, ${input.subject_id}, ${input.project_id}, ${input.actor}, ${JSON.stringify(parsed.data)}, CURRENT_TIMESTAMP, 'pending')
		RETURNING *
	`);
	return ok(rows[0]);
}

/**
 * Runs `write` and, on success, emits the event(s) `to_event` derives from
 * its value — both inside one `run_atomic` call. `to_event` returning `null`
 * means "no event for this outcome" (e.g. a guarded UPDATE matched 0 rows).
 * A failing emission (bad payload, or a caller bug) rolls back `write`'s
 * state change too on the bun-sqlite path, which is what the outbox-pairing
 * invariant actually requires.
 */
export async function write_with_event<T, E>(
	db: Database,
	write: () => Promise<Result<T, E>>,
	to_event: (value: T) => EmitEventInput | EmitEventInput[] | null,
): Promise<Result<T, E | ValidationError | DatabaseError>> {
	return run_atomic(db, async (): Promise<Result<T, E | ValidationError | DatabaseError>> => {
		const result = await write();
		if (!result.ok) return result;

		const derived = to_event(result.value);
		const events = derived == null ? [] : Array.isArray(derived) ? derived : [derived];
		for (const event_input of events) {
			const emitted = await emit_event(db, event_input);
			if (!emitted.ok) return emitted;
		}
		return result;
	});
}

/**
 * Pure predicate behind `node.children_all_done` — fires (returns `true`)
 * only when there is at least one non-deleted child AND every one of them is
 * COMPLETED. Vacuous zero-children NEVER fires (property-suite invariant).
 * Whether firing also cascades a parent's own completion is a policy
 * decision made by the caller (task A2.2's CompletionEngine) — this
 * function only answers "are the children done", nothing more.
 */
export function children_all_done(children: { deleted: boolean; progress: string }[]): boolean {
	const alive = children.filter((c) => !c.deleted);
	if (alive.length === 0) return false;
	return alive.every((c) => c.progress === "COMPLETED");
}
