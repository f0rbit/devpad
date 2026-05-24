/**
 * @module pipelines/providers/approval-store
 *
 * Production {@link ApprovalStore} backed by D1 via Drizzle. Reads and
 * writes the `pipeline_approval` table.
 *
 * The orchestrator's `approve_stage` service writes the row directly
 * for audit, but the manual-gate evaluator reads/writes via this store
 * — keeping the gate code unaware of D1.
 *
 * `write_pending` is a no-op today: pending state is implicit in the
 * absence of a decision row. Kept on the interface so a future
 * implementation can record an explicit pending sentinel if the gate
 * evaluator ever needs richer waiting semantics.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import type { ApprovalDecision } from "@devpad/schema";
import { pipeline_approval } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { ApprovalStore, Decision, StoreError } from "@devpad/core/services/pipelines/gates";
import { and, desc, eq } from "drizzle-orm";

const make_approval_id = (): string => `pipeline-approval_${crypto.randomUUID()}`;

const decision_to_db = (d: Decision): ApprovalDecision => (d === "approved" ? "approved" : "denied");

const db_to_decision = (d: ApprovalDecision | null): Decision | null => {
	if (d === "approved") return "approved";
	if (d === "denied") return "denied";
	return null;
};

/**
 * Pure constructor — closes over the Drizzle handle. The store is a
 * thin record mapper; all side effects live in the methods.
 */
export const make_d1_approval_store = (db: Database): ApprovalStore => ({
	write_pending: async (_run_id: string, _stage: string, _scope?: string): Promise<Result<void, StoreError>> => {
		return ok(undefined);
	},

	read_decision: async (run_id: string, stage: string): Promise<Result<Decision | null, StoreError>> => {
		try {
			const rows = await db
				.select({ decision: pipeline_approval.decision })
				.from(pipeline_approval)
				.where(and(eq(pipeline_approval.run_id, run_id), eq(pipeline_approval.stage_name, stage)))
				.orderBy(desc(pipeline_approval.decided_at))
				.limit(1);
			const row = rows[0];
			if (!row) return ok(null);
			return ok(db_to_decision(row.decision));
		} catch (e) {
			return err({ kind: "store_error", operation: "read_decision", message: String(e) });
		}
	},

	write_decision: async (run_id: string, stage: string, decision: Decision): Promise<Result<void, StoreError>> => {
		try {
			const now = new Date().toISOString();
			await db.insert(pipeline_approval).values({
				id: make_approval_id(),
				run_id,
				stage_name: stage,
				decision: decision_to_db(decision),
				reason: null,
				decided_by: "system",
				decided_at: now,
				created_at: now,
				updated_at: now,
			} as never);
			return ok(undefined);
		} catch (e) {
			return err({ kind: "store_error", operation: "write_decision", message: String(e) });
		}
	},
});
