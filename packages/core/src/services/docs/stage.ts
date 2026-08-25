/**
 * @module core/services/docs/stage
 *
 * v2.4 (task A4.5) — the SDLC stage enum + checkpoint-gated transitions.
 * Gently enforced (locked decision 5): a gated hop without its checkpoint
 * is rejected naming exactly what's missing, but a manual override always
 * succeeds — visibly, via an audit `action` row + `override:true` on the
 * emitted stage event. No hard guard machine.
 */

import type { SdlcStage } from "@devpad/schema/database/schema";
import { action, task } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Task } from "@devpad/schema/types";
import { ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { get_task_row } from "../graph/graph.js";
import { type EmitEventInput, write_with_event } from "../graph/outbox.js";
import { list_documents } from "./store.js";
import { latest_decided_signoff } from "./signoff.js";

export type StageError = ServiceError;

/**
 * Forward gates named by the architecture decision: plan→build needs an
 * approved `stage`-subject "plan" checkpoint (decoupled from any specific
 * document — works even for tasks that never used the doc store);
 * review→deploy needs an approved `stage`-subject "types" checkpoint
 * always, plus an approved `doc_version` "design" checkpoint on the task's
 * design doc — but ONLY when one exists. Every other forward hop
 * (ideate→plan, build→review, deploy→live) is ungated.
 */
async function missing_checkpoints(
	db: Database,
	task_row: Task,
	to: SdlcStage,
): Promise<Result<string[], ServiceError>> {
	const from = task_row.stage;
	const missing: string[] = [];

	if (from === "plan" && to === "build") {
		const plan_signoff = await latest_decided_signoff(db, "stage", task_row.id, "plan");
		if (!plan_signoff.ok) return plan_signoff;
		if (!plan_signoff.value) missing.push("plan");
	}

	if (from === "review" && to === "deploy") {
		const types_signoff = await latest_decided_signoff(db, "stage", task_row.id, "types");
		if (!types_signoff.ok) return types_signoff;
		if (!types_signoff.value) missing.push("types");

		const docs_result = await list_documents(db, { task_id: task_row.id });
		if (!docs_result.ok) return docs_result;
		const design_doc = docs_result.value.find((d) => d.kind === "design");
		if (design_doc) {
			const design_signoff = await latest_decided_signoff(db, "doc_version", design_doc.id, "design");
			if (!design_signoff.ok) return design_signoff;
			if (!design_signoff.value) missing.push("design");
		}
	}

	return ok(missing);
}

export async function advance(
	db: Database,
	task_id: string,
	to: SdlcStage,
	ctx: { actor: "user" | "api"; override?: boolean; reason?: string },
): Promise<Result<Task, StageError>> {
	const task_row = await get_task_row(db, task_id);
	if (!task_row || task_row.deleted) return errors.notFound("task", task_id);
	const from = task_row.stage;

	if (!ctx.override) {
		const missing = await missing_checkpoints(db, task_row, to);
		if (!missing.ok) return missing;
		if (missing.value.length > 0) {
			return errors.conflict(
				"task",
				`Stage transition ${from ?? "(none)"} -> ${to} is missing checkpoint(s): ${missing.value.join(", ")}`,
			);
		}
	}

	const write_result = await write_with_event(
		db,
		async (): Promise<Result<Task | null, ServiceError>> => {
			const rows = await db
				.update(task)
				.set({ stage: to, updated_at: new Date().toISOString() })
				.where(eq(task.id, task_id))
				.returning();
			return ok(rows[0] ?? null);
		},
		(row): EmitEventInput | null =>
			row && {
				kind: "stage.advanced",
				subject_id: row.id,
				project_id: row.project_id,
				actor: ctx.actor,
				payload: { kind: "stage.advanced", from, to, override: Boolean(ctx.override) },
			},
	);
	if (!write_result.ok) return write_result;
	if (!write_result.value) return errors.notFound("task", task_id);
	const updated = write_result.value;

	if (ctx.override) {
		await db.insert(action).values({
			owner_id: updated.owner_id,
			type: "ADVANCE_STAGE",
			description: `Overrode stage gate ${from ?? "(none)"} -> ${to}`,
			data: { task_id, from, to, override: true, reason: ctx.reason ?? null },
			channel: ctx.actor,
		});
	}

	return ok(updated);
}
