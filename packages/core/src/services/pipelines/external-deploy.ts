/**
 * @module core/services/pipelines/external-deploy
 *
 * Side-effect helpers for external deploy mode (#155). The state machine
 * stays pure; this module owns the two things external mode does that
 * orchestrated mode never does:
 *
 * - claim a `pipeline_dispatch` row (at-most-once per `(run_id, stage)`
 *   via the table's unique key), then dispatch the CI workflow and mark
 *   the row `dispatched` / `failed`
 * - re-dispatch a FAILED dispatch row via a guarded UPDATE
 *   (`WHERE status = 'failed'`) so a raced double-caller loses safely
 *
 * Invariant: external packages never take their gate or target from the
 * request — the plan is derived from the package row, with
 * `external_target` validated through `external_target` at this
 * boundary (raw JSON on the row is untrusted).
 */

import type { ExternalTarget } from "@devpad/schema/validation";
import { external_target as external_target_schema } from "@devpad/schema/validation";
import { pipeline_dispatch } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { PipelineRun } from "@devpad/schema/types";
import type { Gate, Stage, TransitionKey } from "@devpad/pipeline-templates";
import { err, ok, try_catch_async, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { EXTERNAL_DISPATCH_STAGE } from "./dispatch.js";
import { record_stage_event_row } from "./stage-events.js";
import type { AdvanceError, RunDeps } from "./runs.js";

const make_dispatch_id = (): string => `pipeline-dispatch_${crypto.randomUUID()}`;

/**
 * Pure: the fixed resolved plan every external run walks. Deploy runs get
 * `[staging, production]` — staging is deployed by CI *before* the run is
 * created, so the orchestrator's stage-0 deploy is a no-op while it waits
 * for CI's staging `deploy_completed`. Rollback runs walk `[production]`
 * alone (there is no CI staging deploy to wait for; the rollback run
 * dispatches production directly). The — always-`manual` — gate comes from
 * the package row, never from the request.
 */
export const external_plan_stages = (kind: "deploy" | "rollback"): Stage[] => {
	const staging: Stage = { name: "staging", traffic: 0, bake: null };
	const production: Stage = { name: "production", traffic: 100, bake: null };
	return kind === "rollback" ? [production] : [staging, production];
};

export const external_plan_gates = (
	kind: "deploy" | "rollback",
	gate: ExternalTarget["gate"],
): Record<TransitionKey, Gate> => (kind === "rollback" ? {} : { "staging→production": gate });

const is_unique_violation = (e: unknown): boolean => {
	const message = e instanceof Error ? e.message : String(e);
	return message.includes("UNIQUE constraint failed");
};

/**
 * Claim the (run_id, stage) dispatch slot by inserting the row. The
 * table's unique key turns a raced/second claimer into a constraint
 * violation, which resolves as `"already"` — the caller must do nothing.
 */
export const claim_dispatch = async (
	db: Database,
	input: { run_id: string; stage_name: string; commit_sha: string; requested_by: string | null },
): Promise<Result<"claimed" | "already", ServiceError>> => {
	const now = new Date().toISOString();
	try {
		await db.insert(pipeline_dispatch).values({
			id: make_dispatch_id(),
			run_id: input.run_id,
			stage_name: input.stage_name,
			commit_sha: input.commit_sha,
			status: "claimed",
			error: null,
			requested_by: input.requested_by,
			created_at: now,
			updated_at: now,
		});
		return ok("claimed");
	} catch (e) {
		if (is_unique_violation(e)) return ok("already");
		return err({ kind: "store_error", operation: "insert_pipeline_dispatch", message: String(e) });
	}
};

const set_dispatch_status = async (
	deps: RunDeps,
	input: { run_id: string; stage_name: string; status: "dispatched" | "failed"; error?: string },
): Promise<Result<void, ServiceError>> => {
	try {
		await deps.db
			.update(pipeline_dispatch)
			.set({ status: input.status, error: input.error ?? null, updated_at: new Date().toISOString() })
			.where(and(eq(pipeline_dispatch.run_id, input.run_id), eq(pipeline_dispatch.stage_name, input.stage_name)));
		return ok(undefined);
	} catch (e) {
		return err({ kind: "store_error", operation: "update_pipeline_dispatch", message: String(e) });
	}
};

export type ExternalDispatchOutcome = { claimed: boolean };

/**
 * Claim + dispatch `stage` for an external run. `claimed: false` means
 * another claimant already holds the slot (or the dispatch failed and the
 * run stays parked in `deploying`) — the caller does nothing.
 */
export const execute_external_dispatch = async (
	deps: RunDeps,
	input: {
		run: PipelineRun;
		external_target: ExternalTarget;
		stage_name: string;
		claim: "unique_insert" | "already_claimed";
		actor?: string;
	},
): Promise<Result<ExternalDispatchOutcome, AdvanceError>> => {
	if (deps.dispatcher === undefined) {
		return err({
			kind: "validation_error",
			field: "dispatcher",
			message: `external packages require a dispatcher (RunDeps.dispatcher); run ${input.run.id} could not dispatch stage ${input.stage_name}`,
		} satisfies ServiceError);
	}
	const stage_name = input.stage_name;
	const sha = input.run.commit_sha ?? "";

	if (input.claim === "unique_insert") {
		const claim = await claim_dispatch(deps.db, {
			run_id: input.run.id,
			stage_name,
			commit_sha: sha,
			requested_by: input.actor ?? null,
		});
		if (!claim.ok) return claim;
		if (claim.value === "already") return ok({ claimed: false });
	}

	const requested = await record_stage_event_row(deps.db, {
		run_id: input.run.id,
		stage_name,
		kind: "dispatch_requested",
		payload: {
			stage: stage_name,
			sha,
			requested_by: input.actor ?? null,
			redispatch: input.claim === "already_claimed",
		},
	});
	if (!requested.ok) return requested;

	const dispatched = await deps.dispatcher.dispatch({
		repo: input.external_target.repo,
		workflow: input.external_target.workflow,
		ref: input.external_target.ref,
		inputs: { stage: stage_name, sha, run_id: input.run.id },
	});

	if (!dispatched.ok) {
		const error_message = dispatched.error.message;
		const marked = await set_dispatch_status(deps, {
			run_id: input.run.id,
			stage_name,
			status: "failed",
			error: error_message,
		});
		if (!marked.ok) return marked;
		const failed_event = await record_stage_event_row(deps.db, {
			run_id: input.run.id,
			stage_name,
			kind: "dispatch_failed",
			payload: { stage: stage_name, error: error_message },
		});
		if (!failed_event.ok) return failed_event;
		// The run stays in `deploying` — a phase-2 UI will offer
		// `redispatch`. The failure is recorded on the dispatch row + as a
		// stage event, not crashed through to the caller.
		return ok({ claimed: false });
	}

	const marked = await set_dispatch_status(deps, { run_id: input.run.id, stage_name, status: "dispatched" });
	if (!marked.ok) return marked;
	return ok({ claimed: true });
};

/**
 * Re-dispatch a FAILED dispatch row. Guarded flip `failed → claimed`
 * (`WHERE status = 'failed'`; zero rows → typed conflict — the dispatch
 * either isn't failed or never existed), then the normal dispatch path.
 * Human-only at the route layer; `actor` is recorded as `requested_by`.
 */
export const redispatch_failed = async (
	deps: RunDeps,
	run: PipelineRun,
	external_target: ExternalTarget,
	actor: string,
): Promise<Result<ExternalDispatchOutcome, AdvanceError>> => {
	if (deps.dispatcher === undefined) {
		return err({
			kind: "validation_error",
			field: "dispatcher",
			message: "external packages require a dispatcher (RunDeps.dispatcher)",
		} satisfies ServiceError);
	}
	const flipped = await try_catch_async(
		() =>
			deps.db
				.update(pipeline_dispatch)
				.set({ status: "claimed", error: null, requested_by: actor, updated_at: new Date().toISOString() })
				.where(
					and(
						eq(pipeline_dispatch.run_id, run.id),
						eq(pipeline_dispatch.stage_name, EXTERNAL_DISPATCH_STAGE),
						eq(pipeline_dispatch.status, "failed"),
					),
				)
				.returning(),
		(e: unknown) => ({ kind: "store_error" as const, operation: "redispatch_pipeline_dispatch", message: String(e) }),
	);
	if (!flipped.ok) return flipped;
	if (flipped.value.length === 0) {
		return err({
			kind: "conflict",
			resource: "pipeline_dispatch",
			message: "no failed dispatch to redispatch",
		} satisfies ServiceError);
	}
	return execute_external_dispatch(deps, {
		run,
		external_target,
		stage_name: EXTERNAL_DISPATCH_STAGE,
		claim: "already_claimed",
		actor,
	});
};

/**
 * Parse the raw `external_target` JSON off a package row. Fail-closed: a
 * row whose payload doesn't validate is a typed error, never silently
 * orchestrated.
 */
export const parse_external_target = (raw: unknown): Result<ExternalTarget, ServiceError> => {
	const parsed = external_target_schema.safeParse(raw);
	if (!parsed.success) {
		return err({
			kind: "validation_error",
			field: "external_target",
			message: `invalid external_target: ${JSON.stringify(parsed.error.issues)}`,
		});
	}
	return ok(parsed.data);
};
