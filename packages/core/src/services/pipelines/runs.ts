/**
 * @module core/services/pipelines/runs
 *
 * Side-effect-bearing service layer for pipeline runs. Holds the
 * orchestration that touches D1, Cloudflare, the pulse emitter and the
 * gate-evaluator registry — the state machine in
 * {@link ./state-machine.ts} stays pure.
 *
 * Surface:
 *
 * - `resolve_run_plan` — pure helper: expand the declared rollout
 *   against the version-set manifest, snapshot it into a
 *   {@link ResolvedPlan}.
 * - `create_run` — persist a `pipeline_run` row + write the resolved
 *   plan JSON onto the row.
 * - `get_run` — read by id.
 * - `cancel_run` — emit a `cancel` event and persist the cancelled state.
 * - `approve_stage` — write a `pipeline_approval` row and fire a
 *   `gate_verdict` event.
 * - `record_stage_event` — append to `pipeline_stage_event`.
 * - `advance_run` — apply a single state-machine event to a run and
 *   execute the resulting `TransitionOutput` side effect (deploy,
 *   gate eval, rollback). Returns the output for the caller to chain
 *   the next event.
 * - `drive_run` — convenience loop that calls `advance_run` repeatedly
 *   until the run hits a halting output (`needs_bake_schedule`, `done`,
 *   or an external-input wait like a manual pending verdict). Used by
 *   integration tests and the DO wrapper.
 */

import type { CloudflareProvider } from "@devpad/pipeline-fakes";
import type { Gate, PipelineTemplate, Stage, TransitionKey } from "@devpad/pipeline-templates";
import { defaultAtomicGates, expand_rollout, resolve_rollout } from "@devpad/pipeline-templates";
import type { ApprovalDecision, PipelineRun, PipelineStageEvent, StageEventKind, UpsertPipelineRun } from "@devpad/schema";
import { pipeline_approval, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { err, ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { type DeployError, deploy_stage } from "./deploy.js";
import type { ApprovalStore, GateError, GateEvaluatorDeps, PulseEmitter } from "./gates/index.js";
import { gateEvaluatorFor } from "./gates/index.js";
import { type RollbackError, rollback_run, type VersionSetRef } from "./rollback.js";
import { type ResolvedPlan, type RunEvent, type RunState, type TransitionError, type TransitionOutput, transition } from "./state-machine.js";

export type RunDeps = {
	db: Database;
	cf: CloudflareProvider;
	pulse: PulseEmitter;
	approvals: ApprovalStore;
	lineage?: (package_id: string) => Promise<Result<VersionSetRef[], ServiceError>>;
};

export type AdvanceError = ServiceError | DeployError | RollbackError | GateError | TransitionError | { kind: "not_found"; resource: string; id?: string };

export type RunRecord = PipelineRun;

const package_script_name = (package_id: string): string => `pipeline_${package_id}`;

/**
 * Take the package's declared {@link PipelineTemplate} and the
 * version-set manifest for this run and snapshot them into the
 * {@link ResolvedPlan} the state machine consumes. Pure — same inputs
 * always produce the same plan.
 *
 * Calls {@link resolve_rollout} (which applies the forced-atomic rules
 * for DO migrations / unaffinitised assets) then {@link expand_rollout}
 * to materialise the ordered `Stage[]` and re-derives the gate map for
 * the resolved shape.
 *
 * `previous_version_set_id` flows in from the caller (looked up via
 * corpus lineage) and is what the state machine hands to a
 * `needs_rollback` output.
 */
export const resolve_run_plan = (input: { template: PipelineTemplate; manifest: VersionSetManifest; version_set_id: string; previous_version_set_id: string | null }): ResolvedPlan => {
	const resolved = resolve_rollout(input.template.rollout, input.manifest);
	const stages = expand_rollout(resolved.rollout);
	// When the discriminator forced the shape, the package's declared
	// gates are keyed against the original (gradual) transition list
	// and will be empty for the new atomic transition. Fall back to
	// the default atomic gates in that case so the state machine has a
	// resolvable gate for every transition.
	const gates_for_resolved: Record<TransitionKey, Gate> = resolved.forced_reason !== null && resolved.rollout.type === "atomic" ? { ...defaultAtomicGates } : input.template.gates;
	return {
		stages,
		gates: gates_for_resolved,
		forced_reason: resolved.forced_reason,
		version_set_id: input.version_set_id,
		previous_version_set_id: input.previous_version_set_id,
	};
};

const stages_to_resolved_rollout_json = (stages: Stage[], shape: "gradual" | "atomic"): unknown => {
	if (shape === "atomic") return { type: "atomic" };
	return {
		type: "gradual",
		stages: stages.filter(s => s.name !== "staging").map(s => ({ name: s.name, traffic: s.traffic, bake: s.bake === null ? null : `${s.bake.ms}ms` })),
	};
};

const gates_to_resolved_gates_json = (gates: Record<TransitionKey, Gate>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(gates)) {
		const g = gates[key as TransitionKey];
		if (g.type === "analysis") out[key] = { type: "analysis", template: g.template.template_id };
		else if (g.type === "auto") out[key] = g.afterBake !== undefined ? { type: "auto", afterBake: g.afterBake } : { type: "auto" };
		else out[key] = { type: "manual" };
	}
	return out;
};

const make_id = (): string => `pipeline-run_${crypto.randomUUID()}`;
const make_event_id = (): string => `pipeline-stage-event_${crypto.randomUUID()}`;
const make_approval_id = (): string => `pipeline-approval_${crypto.randomUUID()}`;

/**
 * Persist a freshly-created run row, snapshotting the resolved plan
 * onto `resolved_rollout` / `resolved_gates` so template edits never
 * affect the in-flight run.
 */
export const create_run = async (
	db: Database,
	input: {
		package_id: string;
		template: PipelineTemplate;
		manifest: VersionSetManifest;
		version_set_id: string;
		previous_version_set_id?: string | null;
	}
): Promise<Result<{ run: PipelineRun; plan: ResolvedPlan }, ServiceError>> => {
	const plan = resolve_run_plan({
		template: input.template,
		manifest: input.manifest,
		version_set_id: input.version_set_id,
		previous_version_set_id: input.previous_version_set_id ?? null,
	});
	const shape = plan.stages.some(s => s.name === "atomic-prod") ? "atomic" : "gradual";

	const now = new Date().toISOString();
	const row_id = make_id();
	const upsert: UpsertPipelineRun = {
		id: row_id,
		package_id: input.package_id,
		version_set_id: input.version_set_id,
		shape,
		status: "queued",
		current_stage: plan.stages[0]?.name ?? null,
		resolved_rollout: stages_to_resolved_rollout_json(plan.stages, shape) as never,
		resolved_gates: gates_to_resolved_gates_json(plan.gates) as never,
		forced_atomic_reason: plan.forced_reason,
		started_at: now,
		finished_at: null,
	};

	try {
		const inserted = await db
			.insert(pipeline_run)
			.values({
				...upsert,
				id: row_id,
				current_stage: upsert.current_stage ?? null,
				started_at: now,
				created_at: now,
				updated_at: now,
				created_by: "api",
				modified_by: "api",
				protected: false,
				deleted: false,
			} as never)
			.returning();
		const row = inserted[0];
		if (!row) {
			return err({ kind: "store_error", operation: "insert_pipeline_run", message: "insert returned no row" } as ServiceError);
		}

		if (plan.forced_reason !== null) {
			await record_stage_event_row(db, {
				run_id: row.id,
				stage_name: plan.stages[0]?.name ?? "staging",
				kind: "warning",
				payload: { kind: "forced_atomic", reason: plan.forced_reason },
			});
		}

		return ok({ run: row, plan });
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_run", message: String(e) } as ServiceError);
	}
};

export const get_run = async (db: Database, run_id: string): Promise<Result<PipelineRun, ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id));
		const row = rows[0];
		if (!row) return err({ kind: "not_found", resource: "pipeline_run", id: run_id } as ServiceError);
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to read pipeline_run ${run_id}: ${String(e)}` } as ServiceError);
	}
};

const update_run_state = async (db: Database, run_id: string, state: RunState, stages: Stage[]): Promise<Result<void, ServiceError>> => {
	const current_stage_name = stages[state.stage_index]?.name ?? null;
	const finished = state.status === "completed" || state.status === "rolled_back" || state.status === "failed" || state.status === "cancelled";
	try {
		await db
			.update(pipeline_run)
			.set({
				status: state.status,
				current_stage: current_stage_name,
				updated_at: new Date().toISOString(),
				modified_by: "api",
				...(finished ? { finished_at: new Date().toISOString() } : {}),
			})
			.where(eq(pipeline_run.id, run_id));
		return ok(undefined);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to update pipeline_run ${run_id}: ${String(e)}` } as ServiceError);
	}
};

const derive_state_from_row = (row: PipelineRun, plan: ResolvedPlan): RunState => {
	const stage_index = row.current_stage
		? Math.max(
				plan.stages.findIndex(s => s.name === row.current_stage),
				0
			)
		: 0;
	let last_deployed_index: number | null;
	if (row.status === "queued") {
		last_deployed_index = null;
	} else if (row.status === "deploying") {
		last_deployed_index = stage_index === 0 ? null : stage_index - 1;
	} else {
		last_deployed_index = stage_index;
	}
	return {
		status: row.status,
		stage_index,
		last_deployed_index,
	};
};

const record_stage_event_row = async (db: Database, input: { run_id: string; stage_name: string; kind: StageEventKind; payload?: unknown }): Promise<Result<PipelineStageEvent, ServiceError>> => {
	try {
		const id = make_event_id();
		const inserted = await db
			.insert(pipeline_stage_event)
			.values({
				id,
				run_id: input.run_id,
				stage_name: input.stage_name,
				kind: input.kind,
				payload: input.payload ?? null,
				ts: new Date().toISOString(),
			} as never)
			.returning();
		const row = inserted[0];
		if (!row) return err({ kind: "store_error", operation: "insert_pipeline_stage_event", message: "insert returned no row" } as ServiceError);
		return ok(row);
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_stage_event", message: String(e) } as ServiceError);
	}
};

export const record_stage_event = record_stage_event_row;

export const cancel_run = async (db: Database, run_id: string, plan: ResolvedPlan): Promise<Result<RunState, AdvanceError>> => {
	const row_result = await get_run(db, run_id);
	if (!row_result.ok) return row_result;
	const state = derive_state_from_row(row_result.value, plan);
	const t = transition(state, { kind: "cancel" }, plan);
	if (!t.ok) return t;
	const persisted = await update_run_state(db, run_id, t.value.next, plan.stages);
	if (!persisted.ok) return persisted;
	await record_stage_event_row(db, {
		run_id,
		stage_name: plan.stages[t.value.next.stage_index]?.name ?? "staging",
		kind: "error",
		payload: { kind: "cancel" },
	});
	return ok(t.value.next);
};

/**
 * Record a manual-gate approval decision. Writes a `pipeline_approval`
 * row and feeds the verdict back through {@link advance_run}.
 */
export const approve_stage = async (deps: RunDeps, input: { run_id: string; stage_name: string; decision: ApprovalDecision; user_id: string; reason?: string }, plan: ResolvedPlan): Promise<Result<TransitionOutput, AdvanceError>> => {
	const now = new Date().toISOString();
	try {
		await deps.db.insert(pipeline_approval).values({
			id: make_approval_id(),
			run_id: input.run_id,
			stage_name: input.stage_name,
			decision: input.decision,
			reason: input.reason ?? null,
			decided_by: input.user_id,
			decided_at: now,
			created_at: now,
			updated_at: now,
		} as never);
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_approval", message: String(e) } as ServiceError);
	}

	// Mirror the decision into the approval store so re-evaluating a
	// manual gate sees it. The in-memory store is the source of truth
	// the manual evaluator reads.
	const write = await deps.approvals.write_decision(input.run_id, input.stage_name, input.decision);
	if (!write.ok) return write as Result<TransitionOutput, AdvanceError>;

	// Record the resolved verdict as a stage event so downstream
	// observers see the human decision, not just the prior Pending.
	await record_stage_event_row(deps.db, {
		run_id: input.run_id,
		stage_name: input.stage_name,
		kind: "gate_verdict",
		payload: { type: "manual", verdict: input.decision === "approved" ? "Pass" : "Fail", reason: input.reason },
	});

	return advance_run(deps, input.run_id, { kind: "gate_verdict", verdict: input.decision === "approved" ? "Pass" : "Fail", reason: input.reason }, plan);
};

const gate_deps_from = (deps: RunDeps): GateEvaluatorDeps => ({ pulse: deps.pulse, approvals: deps.approvals });

/**
 * Execute the side-effect output produced by a transition. Returns the
 * next event to feed back (or `null` to stop).
 */
const execute_output = async (deps: RunDeps, run_id: string, plan: ResolvedPlan, state: RunState, output: TransitionOutput): Promise<Result<{ output: TransitionOutput; next_event: RunEvent | null }, AdvanceError>> => {
	if (output.kind === "done") {
		return ok({ output, next_event: null });
	}

	if (output.kind === "needs_bake_schedule") {
		await record_stage_event_row(deps.db, {
			run_id,
			stage_name: output.stage.name,
			kind: "bake_started",
			payload: { duration_ms: output.duration_ms },
		});
		return ok({ output, next_event: null });
	}

	if (output.kind === "needs_deploy") {
		const script_name = await package_script_for_run(deps.db, run_id);
		if (!script_name.ok) return script_name;
		await record_stage_event_row(deps.db, {
			run_id,
			stage_name: output.stage.name,
			kind: "deploy_started",
			payload: { traffic: output.stage.traffic, version_set_id: output.version_set_id },
		});
		const deployed = await deploy_stage(deps.cf, {
			script_name: script_name.value,
			stage: output.stage,
			version_set_id: output.version_set_id,
		});
		if (!deployed.ok) return deployed;
		await record_stage_event_row(deps.db, {
			run_id,
			stage_name: output.stage.name,
			kind: "deploy_completed",
			payload: { deployment_id: deployed.value.deployment_id, version_id: deployed.value.version.id },
		});
		return ok({ output, next_event: { kind: "deploy_complete" } });
	}

	if (output.kind === "needs_gate_eval") {
		const evaluator = gateEvaluatorFor(output.gate, gate_deps_from(deps));
		const verdict = await evaluator.evaluate({
			run_id,
			package: "",
			version_set_id: plan.version_set_id,
			from_stage: output.from_stage.name,
			to_stage: output.to_stage.name,
			gate: output.gate,
		});
		if (!verdict.ok) return verdict;
		// Record the gate_verdict event only when the verdict is
		// resolved (Pass/Fail). Pending is a transient waiting state —
		// the corresponding human decision will be recorded by
		// {@link approve_stage} once it arrives.
		if (verdict.value.verdict !== "Pending") {
			await record_stage_event_row(deps.db, {
				run_id,
				stage_name: output.to_stage.name,
				kind: "gate_verdict",
				payload: { type: output.gate.type, verdict: verdict.value.verdict, reason: verdict.value.reason },
			});
		}
		return ok({
			output,
			next_event: { kind: "gate_verdict", verdict: verdict.value.verdict, reason: verdict.value.verdict === "Pass" || verdict.value.verdict === "Fail" ? verdict.value.reason : undefined },
		});
	}

	if (output.kind === "needs_rollback") {
		const script_name = await package_script_for_run(deps.db, run_id);
		if (!script_name.ok) return script_name;
		await record_stage_event_row(deps.db, {
			run_id,
			stage_name: plan.stages[state.stage_index]?.name ?? "staging",
			kind: "rollback_started",
			payload: { target_version_set_id: output.previous_version_set_id },
		});
		const result = await rollback_run(deps.cf, {
			script_name: script_name.value,
			target_version_set_id: output.previous_version_set_id,
		});
		if (!result.ok) return result;
		await record_stage_event_row(deps.db, {
			run_id,
			stage_name: plan.stages[state.stage_index]?.name ?? "staging",
			kind: "rollback_completed",
			payload: { deployment_id: result.value.deployment_id, version_id: result.value.version_id },
		});
		return ok({ output, next_event: { kind: "deploy_complete" } });
	}

	return ok({ output, next_event: null });
};

const package_script_for_run = async (db: Database, run_id: string): Promise<Result<string, ServiceError>> => {
	const run = await get_run(db, run_id);
	if (!run.ok) return run;
	return ok(package_script_name(run.value.package_id));
};

/**
 * Apply a single state-machine event to a run, persist the new state,
 * execute the side effect implied by the resulting `TransitionOutput`,
 * and return the output for the caller to continue driving the run.
 *
 * Halts (returns the output as-is) when the output is `done`,
 * `needs_bake_schedule`, or a `Pending` gate verdict — those are the
 * three "wait for external input" boundaries.
 */
export const advance_run = async (deps: RunDeps, run_id: string, event: RunEvent, plan: ResolvedPlan): Promise<Result<TransitionOutput, AdvanceError>> => {
	const row_result = await get_run(deps.db, run_id);
	if (!row_result.ok) return row_result;
	const state = derive_state_from_row(row_result.value, plan);

	const t = transition(state, event, plan);
	if (!t.ok) return t;

	const persisted = await update_run_state(deps.db, run_id, t.value.next, plan.stages);
	if (!persisted.ok) return persisted;

	const executed = await execute_output(deps, run_id, plan, t.value.next, t.value.emit);
	if (!executed.ok) return executed;

	if (executed.value.next_event === null) return ok(executed.value.output);
	return advance_run(deps, run_id, executed.value.next_event, plan);
};

/**
 * Drive a run forward from `queued`, applying the `start` event and
 * looping until the run hits a halting output. Convenience for tests
 * and the DO wrapper.
 */
export const drive_run = async (deps: RunDeps, run_id: string, plan: ResolvedPlan): Promise<Result<TransitionOutput, AdvanceError>> => {
	return advance_run(deps, run_id, { kind: "start" }, plan);
};

/**
 * Resume a run from `baking` — fed by the DO alarm or by a test that
 * wants to skip the bake window.
 */
export const tick_bake_complete = async (deps: RunDeps, run_id: string, plan: ResolvedPlan): Promise<Result<TransitionOutput, AdvanceError>> => {
	return advance_run(deps, run_id, { kind: "bake_complete" }, plan);
};

/**
 * Request a rollback of an in-flight (or recently-completed) run.
 */
export const request_rollback = async (deps: RunDeps, run_id: string, plan: ResolvedPlan): Promise<Result<TransitionOutput, AdvanceError>> => {
	return advance_run(deps, run_id, { kind: "rollback_requested" }, plan);
};
