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
import type { PulseSummaryProvider } from "@devpad/pipeline-fakes/pulse-summary";
import type { Gate, PipelineTemplate, Stage, TransitionKey } from "@devpad/pipeline-templates";
import { defaultAtomicGates, expand_rollout, resolve_rollout } from "@devpad/pipeline-templates";
import { type ExternalTarget } from "@devpad/schema/validation";
import type { ApprovalDecision, PipelineRun, StageEventKind, UpsertPipelineRun } from "@devpad/schema";
import { pipeline_approval, pipeline_run } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { environment_for_stage } from "./caller-identity.js";
import { type BundleProvider, type DeployError, deploy_stage } from "./deploy.js";
import type { ApprovalStore, GateError, GateEvaluatorDeps, PulseEmitter } from "./gates/index.js";
import { gateEvaluatorFor } from "./gates/index.js";
import type { Dispatcher } from "./dispatch.js";
import {
	type ExternalDispatchOutcome,
	external_plan_gates,
	external_plan_stages,
	execute_external_dispatch,
	parse_external_target,
	redispatch_failed,
} from "./external-deploy.js";
import { get_package } from "./packages.js";
import { type RollbackError, rollback_run, type VersionSetRef } from "./rollback.js";
import { resolve_script_name } from "./script-name.js";
import { record_stage_event_row } from "./stage-events.js";
import {
	is_terminal_status,
	type ResolvedPlan,
	type RunEvent,
	type RunState,
	type RunTarget,
	target_version_id,
	type TransitionError,
	type TransitionOutput,
	transition,
} from "./state-machine.js";

export type RunDeps = {
	db: Database;
	cf: CloudflareProvider;
	bundles: BundleProvider;
	pulse: PulseEmitter;
	approvals: ApprovalStore;
	/** CI-workflow dispatch seam for external deploy mode (#155). Absent →
	 * external runs fail fast with a typed error. */
	dispatcher?: Dispatcher;
	pulse_summary?: PulseSummaryProvider;
	now?: () => number;
	lineage?: (package_id: string) => Promise<Result<VersionSetRef[], ServiceError>>;
};

export type AdvanceError =
	| ServiceError
	| DeployError
	| RollbackError
	| GateError
	| TransitionError
	| { kind: "not_found"; resource: string; id?: string };

export type RunRecord = PipelineRun;

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
export const resolve_run_plan = (input: {
	template: PipelineTemplate;
	manifest: VersionSetManifest;
	version_set_id: string;
	previous_version_set_id: string | null;
}): ResolvedPlan => {
	const resolved = resolve_rollout(input.template.rollout, input.manifest);
	const stages = expand_rollout(resolved.rollout);
	// When the discriminator forced the shape, the package's declared
	// gates are keyed against the original (gradual) transition list
	// and will be empty for the new atomic transition. Fall back to
	// the default atomic gates in that case so the state machine has a
	// resolvable gate for every transition.
	const gates_for_resolved: Record<TransitionKey, Gate> =
		resolved.forced_reason !== null && resolved.rollout.type === "atomic"
			? { ...defaultAtomicGates }
			: input.template.gates;
	return {
		stages,
		gates: gates_for_resolved,
		forced_reason: resolved.forced_reason,
		target: { kind: "version_set", version_set_id: input.version_set_id },
		previous_version_set_id: input.previous_version_set_id,
		external_timeout_ms: null,
	};
};

/**
 * Pure: the fixed resolved plan for an EXTERNAL run (#155). Driven by the
 * package row's validated `ExternalTarget` — the manual gate and timeout
 * come from the row, never from the request. Deploy runs walk
 * `[staging, production]` (CI deploys staging before run creation);
 * rollback runs walk `[production]` alone.
 */
export const external_plan = (
	external_target: ExternalTarget,
	commit_sha: string,
	kind: "deploy" | "rollback" = "deploy",
): ResolvedPlan => ({
	stages: external_plan_stages(kind),
	gates: external_plan_gates(kind, external_target.gate),
	forced_reason: null,
	target: { kind: "commit", commit_sha },
	previous_version_set_id: null,
	external_timeout_ms: external_target.timeout_ms,
});

const stages_to_resolved_rollout_json = (stages: Stage[], shape: "gradual" | "atomic"): unknown => {
	if (shape === "atomic") return { type: "atomic" };
	return {
		type: "gradual",
		stages: stages
			.filter((s) => s.name !== "staging")
			.map((s) => ({ name: s.name, traffic: s.traffic, bake: s.bake === null ? null : `${String(s.bake.ms)}ms` })),
	};
};

const gates_to_resolved_gates_json = (gates: Record<TransitionKey, Gate>): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(gates)) {
		const g = gates[key as TransitionKey];
		if (g.type === "analysis") out[key] = { type: "analysis", template: g.template.template_id };
		else if (g.type === "auto")
			out[key] = g.afterBake !== undefined ? { type: "auto", afterBake: g.afterBake } : { type: "auto" };
		else out[key] = { type: "manual" };
	}
	return out;
};

const make_id = (): string => `pipeline-run_${crypto.randomUUID()}`;
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
		/** Run kind. Defaults to "deploy". Set "rollback" when creating a
		 * synthetic run that re-deploys the predecessor version-set at 100%
		 * (see `/runs/:id/rollback`). Rollback runs are forced atomic — we
		 * do not gradually roll back. */
		kind?: "deploy" | "rollback";
	},
): Promise<Result<{ run: PipelineRun; plan: ResolvedPlan }, ServiceError>> => {
	const kind = input.kind ?? "deploy";
	const base_plan = resolve_run_plan({
		template: input.template,
		manifest: input.manifest,
		version_set_id: input.version_set_id,
		previous_version_set_id: input.previous_version_set_id ?? null,
	});
	// Rollback runs deploy the prior version atomically; collapse the
	// resolved plan to an atomic-prod stage with auto gates so the state
	// machine never tries to walk onebox/wave* on the way back and never
	// pauses for manual approval (operators triggering a rollback already
	// approved by hitting the endpoint).
	const plan: ResolvedPlan =
		kind === "rollback"
			? {
					stages: expand_rollout({ type: "atomic" }),
					gates: { "staging→atomic-prod": { type: "auto" } },
					forced_reason: null,
					target: { kind: "version_set", version_set_id: input.version_set_id },
					previous_version_set_id: input.previous_version_set_id ?? null,
					external_timeout_ms: null,
				}
			: base_plan;
	const shape = plan.stages.some((s) => s.name === "atomic-prod") ? "atomic" : "gradual";

	const now = new Date().toISOString();
	const row_id = make_id();
	const upsert: UpsertPipelineRun = {
		id: row_id,
		package_id: input.package_id,
		version_set_id: input.version_set_id,
		commit_sha: null,
		shape,
		kind,
		status: "queued",
		current_stage: plan.stages[0]?.name ?? null,
		resolved_rollout: stages_to_resolved_rollout_json(plan.stages, shape) as never,
		resolved_gates: gates_to_resolved_gates_json(plan.gates) as never,
		forced_atomic_reason: plan.forced_reason,
		started_at: now,
		finished_at: null,
	};

	try {
		const insert_values = {
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
		};
		const inserted = await db
			.insert(pipeline_run)
			.values(insert_values as never)
			.returning();
		const row = inserted.at(0);
		if (!row) {
			return err({
				kind: "store_error",
				operation: "insert_pipeline_run",
				message: "insert returned no row",
			});
		}

		if (plan.forced_reason !== null) {
			const forced_event = await record_stage_event_row(db, {
				run_id: row.id,
				stage_name: plan.stages[0]?.name ?? "staging",
				kind: "warning",
				payload: { kind: "forced_atomic", reason: plan.forced_reason },
			});
			if (!forced_event.ok) return forced_event;
		}

		return ok({ run: row, plan });
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_run", message: String(e) });
	}
};

/**
 * Parse the run row's nullable `version_set_id` / `commit_sha` pair into
 * the {@link RunTarget} union. The DB doesn't carry a CHECK for
 * "exactly one set" — this boundary parser is the enforcement point:
 * `null` means the row is malformed (both or neither set) and callers
 * treat it as an orchestrated-vs-external ambiguity they must refuse.
 */
export const run_target_of = (row: Pick<PipelineRun, "version_set_id" | "commit_sha">): RunTarget | null => {
	if (row.commit_sha !== null && row.version_set_id === null) {
		return { kind: "commit", commit_sha: row.commit_sha };
	}
	if (row.version_set_id !== null && row.commit_sha === null) {
		return { kind: "version_set", version_set_id: row.version_set_id };
	}
	return null;
};

/**
 * Persist a freshly-created EXTERNAL run row (#155). No template / manifest
 * / version-set is involved; the resolved plan is the fixed external shape
 * derived from the validated `ExternalTarget`. `version_set_id` stays null
 * and `commit_sha` carries the run's target SHA.
 */
export const create_external_run = async (
	db: Database,
	input: {
		package_id: string;
		commit_sha: string;
		external_target: ExternalTarget;
		kind?: "deploy" | "rollback";
	},
): Promise<Result<{ run: PipelineRun; plan: ResolvedPlan }, ServiceError>> => {
	const kind = input.kind ?? "deploy";
	const plan = external_plan(input.external_target, input.commit_sha, kind);
	const shape: "gradual" | "atomic" = "gradual";
	const now = new Date().toISOString();
	const row_id = make_id();
	const upsert: UpsertPipelineRun = {
		id: row_id,
		package_id: input.package_id,
		version_set_id: null,
		commit_sha: input.commit_sha,
		shape,
		kind,
		status: "queued",
		current_stage: plan.stages[0]?.name ?? null,
		resolved_rollout: stages_to_resolved_rollout_json(plan.stages, shape) as never,
		resolved_gates: gates_to_resolved_gates_json(plan.gates) as never,
		forced_atomic_reason: plan.forced_reason,
		started_at: now,
		finished_at: null,
	};

	try {
		const insert_values = {
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
		};
		const inserted = await db
			.insert(pipeline_run)
			.values(insert_values as never)
			.returning();
		const row = inserted.at(0);
		if (!row) {
			return err({
				kind: "store_error",
				operation: "insert_pipeline_run",
				message: "insert returned no row",
			});
		}
		return ok({ run: row, plan });
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_run", message: String(e) });
	}
};

export const get_run = async (db: Database, run_id: string): Promise<Result<PipelineRun, ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id));
		const row = rows.at(0);
		if (!row) return err({ kind: "not_found", resource: "pipeline_run", id: run_id });
		return ok(row);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to read pipeline_run ${run_id}: ${String(e)}` });
	}
};

/**
 * List runs ordered by `created_at` DESC, optionally filtered by
 * package and/or status. Used by the catalog UI and the `GET /runs`
 * route. The cap on `limit` (200) is enforced by the caller; this
 * service accepts whatever it's given.
 */
export type ListRunsFilter = {
	package_id?: string;
	status?: PipelineRun["status"];
	limit?: number;
};

export const list_runs = async (
	db: Database,
	filter: ListRunsFilter = {},
): Promise<Result<PipelineRun[], ServiceError>> => {
	try {
		const conditions = [];
		if (filter.package_id !== undefined) conditions.push(eq(pipeline_run.package_id, filter.package_id));
		if (filter.status !== undefined) conditions.push(eq(pipeline_run.status, filter.status));

		const limit = filter.limit ?? 50;
		const base = db.select().from(pipeline_run);
		const where =
			conditions.length === 0
				? base
				: conditions.length === 1
					? base.where(conditions[0])
					: base.where(and(...conditions));
		const rows = await where.orderBy(desc(pipeline_run.created_at)).limit(limit);
		return ok(rows);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to list pipeline_run: ${String(e)}` });
	}
};

const update_run_state = async (
	db: Database,
	run_id: string,
	state: RunState,
	stages: Stage[],
): Promise<Result<void, ServiceError>> => {
	const current_stage_name = stages[state.stage_index]?.name ?? null;
	const finished =
		state.status === "completed" ||
		state.status === "rolled_back" ||
		state.status === "failed" ||
		state.status === "cancelled";
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
		return err({ kind: "db_error", message: `failed to update pipeline_run ${run_id}: ${String(e)}` });
	}
};

/**
 * Stamp the human-readable failure reason onto the run row (#160). The
 * reason is visible through `GET /runs/:id` and paired with a
 * `deploy_failed` stage event carrying the same text in its payload.
 */
const set_run_error = async (db: Database, run_id: string, message: string): Promise<Result<void, ServiceError>> => {
	try {
		await db
			.update(pipeline_run)
			.set({ error: message, updated_at: new Date().toISOString(), modified_by: "api" })
			.where(eq(pipeline_run.id, run_id));
		return ok(undefined);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to set error on pipeline_run ${run_id}: ${String(e)}` });
	}
};

const format_advance_error = (error: AdvanceError): string => {
	const code =
		"code" in error && typeof error.code === "string" ? error.code : "kind" in error ? error.kind : "unknown";
	const detail = "message" in error && typeof error.message === "string" ? error.message : JSON.stringify(error);
	return `${code}: ${detail}`;
};

/**
 * Record a deploy/rollback failure and drive the state machine to
 * `failed` (#160). Previously a failing `deploy_stage` / `rollback_run`
 * just bubbled its error result up, leaving the run stuck in
 * `deploying` / `rolling_back` forever with no recorded reason.
 *
 * The failure is visible in three places: a stage event (kind
 * `deploy_failed` for deploy stages, `error` with a
 * `kind: "rollback_failed"` payload for rollbacks) whose payload carries
 * the formatted error, the run row's `error` column, and the run status
 * itself (`failed` + `finished_at`).
 *
 * The returned Result carries the ORIGINAL typed error so callers (DO,
 * routes) still see the machine-readable failure; the run has already
 * been driven to `failed` by the time it surfaces. If the event row
 * itself fails to record, the original error is returned untouched and
 * the run is retried from `deploying`/`rolling_back` on the next tick
 * rather than silently losing the record.
 */
const fail_run_with_error = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
	input: { stage_name: string; event_kind: StageEventKind; payload: Record<string, unknown>; error: AdvanceError },
): Promise<Result<TransitionOutput, AdvanceError>> => {
	const message = format_advance_error(input.error);
	const recorded = await record_stage_event_row(deps.db, {
		run_id,
		stage_name: input.stage_name,
		kind: input.event_kind,
		payload: { ...input.payload, error: message },
	});
	if (!recorded.ok) return err(input.error);
	const applied = await advance_run(deps, run_id, { kind: "deploy_failed" }, plan);
	if (!applied.ok) return applied;
	const stamped = await set_run_error(deps.db, run_id, message);
	if (!stamped.ok) return stamped;
	return err(input.error);
};

const derive_state_from_row = (row: PipelineRun, plan: ResolvedPlan): RunState => {
	const stage_index = row.current_stage
		? Math.max(
				plan.stages.findIndex((s) => s.name === row.current_stage),
				0,
			)
		: 0;
	let last_deployed_index: number | null;
	if (row.status === "queued") {
		last_deployed_index = null;
	} else if (row.status === "deploying" || row.status === "unconfirmed") {
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

export const record_stage_event = record_stage_event_row;

export const cancel_run = async (
	db: Database,
	run_id: string,
	plan: ResolvedPlan,
): Promise<Result<RunState, AdvanceError>> => {
	const row_result = await get_run(db, run_id);
	if (!row_result.ok) return row_result;
	const state = derive_state_from_row(row_result.value, plan);
	const t = transition(state, { kind: "cancel" }, plan);
	if (!t.ok) return t;
	const persisted = await update_run_state(db, run_id, t.value.next, plan.stages);
	if (!persisted.ok) return persisted;
	const cancel_event = await record_stage_event_row(db, {
		run_id,
		stage_name: plan.stages[t.value.next.stage_index]?.name ?? "staging",
		kind: "error",
		payload: { kind: "cancel" },
	});
	if (!cancel_event.ok) return cancel_event;
	return ok(t.value.next);
};

/**
 * Record a manual-gate approval decision. Writes a `pipeline_approval`
 * row and feeds the verdict back through {@link advance_run}.
 */
export const approve_stage = async (
	deps: RunDeps,
	input: { run_id: string; stage_name: string; decision: ApprovalDecision; user_id: string; reason?: string },
	plan: ResolvedPlan,
): Promise<Result<TransitionOutput, AdvanceError>> => {
	const now = new Date().toISOString();
	try {
		const insert_values = {
			id: make_approval_id(),
			run_id: input.run_id,
			stage_name: input.stage_name,
			decision: input.decision,
			reason: input.reason ?? null,
			decided_by: input.user_id,
			decided_at: now,
			created_at: now,
			updated_at: now,
		};
		await deps.db.insert(pipeline_approval).values(insert_values as never);
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_approval", message: String(e) });
	}

	// Mirror the decision into the approval store so re-evaluating a
	// manual gate sees it. The in-memory store is the source of truth
	// the manual evaluator reads.
	const write = await deps.approvals.write_decision(input.run_id, input.stage_name, input.decision);
	if (!write.ok) return write;

	// Record the resolved verdict as a stage event so downstream
	// observers see the human decision, not just the prior Pending.
	const verdict_event = await record_stage_event_row(deps.db, {
		run_id: input.run_id,
		stage_name: input.stage_name,
		kind: "gate_verdict",
		payload: { type: "manual", verdict: input.decision === "approved" ? "Pass" : "Fail", reason: input.reason },
	});
	if (!verdict_event.ok) return verdict_event;

	return advance_run(
		deps,
		input.run_id,
		{
			kind: "gate_verdict",
			verdict: input.decision === "approved" ? "Pass" : "Fail",
			reason: input.reason,
			actor: input.user_id,
		},
		plan,
	);
};

const gate_deps_from = (deps: RunDeps): GateEvaluatorDeps => ({
	pulse: deps.pulse,
	approvals: deps.approvals,
	db: deps.db,
	pulse_summary: deps.pulse_summary,
	now: deps.now,
});

/**
 * Extract the human actor from a state-machine event when one carries it
 * (approve / external rollback start / redispatch). Absent for machine
 * paths — the `pipeline_dispatch.requested_by` audit column is then null.
 */
const actor_from_event = (event: RunEvent | undefined): string | undefined =>
	event !== undefined && "actor" in event && typeof event.actor === "string" ? event.actor : undefined;

/**
 * Execute the side-effect output produced by a transition. Returns the
 * next event to feed back (or `null` to stop).
 */
const execute_output = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
	state: RunState,
	output: TransitionOutput,
	actor?: string,
): Promise<Result<{ output: TransitionOutput; next_event: RunEvent | null }, AdvanceError>> => {
	if (output.kind === "done") {
		return ok({ output, next_event: null });
	}

	if (output.kind === "needs_bake_schedule") {
		const bake_event = await record_stage_event_row(deps.db, {
			run_id,
			stage_name: output.stage.name,
			kind: "bake_started",
			payload: { duration_ms: output.duration_ms },
		});
		if (!bake_event.ok) return bake_event;
		return ok({ output, next_event: null });
	}

	if (output.kind === "needs_deploy") {
		// Executor seam (#155): the run's target kind picks the path.
		// `version_set` → the existing Cloudflare deploy; `commit` → the
		// external CI path (no Cloudflare touch at all).
		if (output.target.kind === "commit")
			return execute_external_deploy_output(deps, run_id, plan, state, output, actor);
		const version_set_id = output.target.version_set_id;
		const resolved = await package_script_for_stage(deps.db, run_id, output.stage.name);
		if (!resolved.ok) {
			return fail_run_with_error(deps, run_id, plan, {
				stage_name: output.stage.name,
				event_kind: "deploy_failed",
				payload: { kind: "deploy_failed", traffic: output.stage.traffic, version_set_id },
				error: resolved.error,
			});
		}
		const started_event = await record_stage_event_row(deps.db, {
			run_id,
			stage_name: output.stage.name,
			kind: "deploy_started",
			payload: { traffic: output.stage.traffic, version_set_id },
		});
		if (!started_event.ok) return started_event;
		const deployed = await deploy_stage(deps.cf, deps.bundles, {
			script_name: resolved.value.script_name,
			stage: output.stage,
			version_set_id,
			package_name: resolved.value.package_name,
			environment: environment_for_stage(output.stage.name),
		});
		if (!deployed.ok) {
			return fail_run_with_error(deps, run_id, plan, {
				stage_name: output.stage.name,
				event_kind: "deploy_failed",
				payload: { kind: "deploy_failed", traffic: output.stage.traffic, version_set_id },
				error: deployed.error,
			});
		}
		const completed_event = await record_stage_event_row(deps.db, {
			run_id,
			stage_name: output.stage.name,
			kind: "deploy_completed",
			payload: { deployment_id: deployed.value.deployment_id, version_id: deployed.value.version.id },
		});
		if (!completed_event.ok) return completed_event;
		return ok({ output, next_event: { kind: "deploy_complete" } });
	}

	if (output.kind === "needs_gate_eval") {
		const evaluator = gateEvaluatorFor(output.gate, gate_deps_from(deps));
		const verdict = await evaluator.evaluate({
			run_id,
			package: "",
			version_set_id: target_version_id(plan.target),
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
			const verdict_event = await record_stage_event_row(deps.db, {
				run_id,
				stage_name: output.to_stage.name,
				kind: "gate_verdict",
				payload: { type: output.gate.type, verdict: verdict.value.verdict, reason: verdict.value.reason },
			});
			if (!verdict_event.ok) return verdict_event;
		}
		return ok({
			output,
			next_event: {
				kind: "gate_verdict",
				verdict: verdict.value.verdict,
				reason: verdict.value.verdict === "Pass" || verdict.value.verdict === "Fail" ? verdict.value.reason : undefined,
			},
		});
	}

	// `output.kind` is exhaustively narrowed to "needs_rollback" by this point
	// -- every other `TransitionOutput` variant returned above, so this is the
	// only case left; a redundant `if` here was dead per the type checker.
	// Adding a new `TransitionOutput` variant will now fail to compile right
	// here (the `output.*` accesses below stop narrowing) instead of silently
	// falling through a catch-all branch.
	const stage_name = plan.stages[state.stage_index]?.name ?? "staging";
	const resolved = await package_script_for_stage(deps.db, run_id, stage_name);
	if (!resolved.ok) {
		return fail_run_with_error(deps, run_id, plan, {
			stage_name,
			event_kind: "error",
			payload: { kind: "rollback_failed", target_version_set_id: output.previous_version_set_id },
			error: resolved.error,
		});
	}
	const started_event = await record_stage_event_row(deps.db, {
		run_id,
		stage_name,
		kind: "rollback_started",
		payload: { target_version_set_id: output.previous_version_set_id },
	});
	if (!started_event.ok) return started_event;
	const result = await rollback_run(deps.cf, {
		script_name: resolved.value.script_name,
		target_version_set_id: output.previous_version_set_id,
	});
	if (!result.ok) {
		return fail_run_with_error(deps, run_id, plan, {
			stage_name,
			event_kind: "error",
			payload: { kind: "rollback_failed", target_version_set_id: output.previous_version_set_id },
			error: result.error,
		});
	}
	const completed_event = await record_stage_event_row(deps.db, {
		run_id,
		stage_name: plan.stages[state.stage_index]?.name ?? "staging",
		kind: "rollback_completed",
		payload: { deployment_id: result.value.deployment_id, version_id: result.value.version_id },
	});
	if (!completed_event.ok) return completed_event;
	return ok({ output, next_event: { kind: "deploy_complete" } });
};

const package_script_for_stage = async (
	db: Database,
	run_id: string,
	stage_name: string,
): Promise<Result<{ script_name: string; package_name: string }, ServiceError>> => {
	const run = await get_run(db, run_id);
	if (!run.ok) return run;

	const pkg = await db.query.pipeline_package.findFirst({
		where: (tbl, { eq: matches }) => matches(tbl.id, run.value.package_id),
	});
	if (!pkg) {
		return err({
			kind: "not_found",
			resource: "pipeline_package",
			id: run.value.package_id,
		});
	}

	try {
		const script_name = resolve_script_name({
			package: {
				name: pkg.name,
				script_name_overrides: pkg.script_name_overrides as Record<string, string> | null,
			},
			stage_name,
		});
		return ok({ script_name, package_name: pkg.name });
	} catch (e) {
		// `field` is required on `ValidationFieldError` -- `stage_name` is the
		// input `resolve_script_name` actually validates (both of its throw
		// conditions -- missing package name, missing stage name -- surface
		// through this one call site keyed by stage).
		return err({
			kind: "validation_error",
			field: "stage_name",
			message: `Failed to resolve script name: ${e instanceof Error ? e.message : String(e)}`,
		});
	}
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
export const advance_run = async (
	deps: RunDeps,
	run_id: string,
	event: RunEvent,
	plan: ResolvedPlan,
): Promise<Result<TransitionOutput, AdvanceError>> => {
	const row_result = await get_run(deps.db, run_id);
	if (!row_result.ok) return row_result;
	const state = derive_state_from_row(row_result.value, plan);

	const t = transition(state, event, plan);
	if (!t.ok) return t;

	const persisted = await update_run_state(deps.db, run_id, t.value.next, plan.stages);
	if (!persisted.ok) return persisted;

	const executed = await execute_output(deps, run_id, plan, t.value.next, t.value.emit, actor_from_event(event));
	if (!executed.ok) return executed;

	if (executed.value.next_event === null) return ok(executed.value.output);
	return advance_run(deps, run_id, executed.value.next_event, plan);
};

/**
 * Drive a run forward from `queued`, applying the `start` event and
 * looping until the run hits a halting output. Convenience for tests
 * and the DO wrapper.
 */
export const drive_run = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
): Promise<Result<TransitionOutput, AdvanceError>> => {
	return advance_run(deps, run_id, { kind: "start" }, plan);
};

/**
 * Resume a run from `baking` — fed by the DO alarm or by a test that
 * wants to skip the bake window.
 */
export const tick_bake_complete = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
): Promise<Result<TransitionOutput, AdvanceError>> => {
	return advance_run(deps, run_id, { kind: "bake_complete" }, plan);
};

/**
 * Request a rollback of an in-flight (or recently-completed) run.
 */
export const request_rollback = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
): Promise<Result<TransitionOutput, AdvanceError>> => {
	return advance_run(deps, run_id, { kind: "rollback_requested" }, plan);
};

/**
 * External-mode stage deploy, driven from {@link execute_output}'s
 * `needs_deploy` output when the run's target is a commit.
 *
 * - stage 0 (`staging`): CI already deployed staging before the run was
 *   created — do nothing, don't move; the run waits in `deploying` for
 *   CI's staging `deploy_completed` event.
 * - other stages (`production`): claim the unique `(run_id, stage)`
 *   dispatch row (a losing racer → `already` → do nothing), record
 *   `dispatch_requested`, dispatch the CI workflow and mark the row
 *   `dispatched`. On dispatch failure the row flips to `failed` + a
 *   `dispatch_failed` event is recorded, and the run stays in
 *   `deploying` (phase-2 UI offers re-dispatch).
 */
const execute_external_deploy_output = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
	state: RunState,
	output: Extract<TransitionOutput, { kind: "needs_deploy" }>,
	actor?: string,
): Promise<Result<{ output: TransitionOutput; next_event: RunEvent | null }, AdvanceError>> => {
	// Staging is CI-own territory for external deploy runs: CI deployed it
	// before the run was created, so the orchestrator does nothing there
	// and waits for CI's staging event. Rollback runs have no staging
	// stage — their first (and only) stage is `production` and dispatches
	// straight away.
	if (output.stage.name === "staging") {
		return ok({ output, next_event: null });
	}
	const run = await get_run(deps.db, run_id);
	if (!run.ok) return run;
	const pkg = await get_package(deps.db, run.value.package_id);
	if (!pkg.ok) return pkg;
	const external_target = parse_external_target(pkg.value.external_target);
	if (!external_target.ok) return external_target;
	const dispatch = await execute_external_dispatch(deps, {
		run: run.value,
		external_target: external_target.value,
		stage_name: output.stage.name,
		claim: "unique_insert",
		actor,
	});
	if (!dispatch.ok) return dispatch;
	return ok({ output, next_event: null });
};

/**
 * Re-dispatch a FAILED `pipeline_dispatch` row for an external run. Only
 * a human may do this (enforced at the route layer with
 * `require_human_actor`); `actor` is recorded as `requested_by`.
 */
export const redispatch = async (
	deps: RunDeps,
	run_id: string,
	actor: string,
): Promise<Result<ExternalDispatchOutcome, AdvanceError>> => {
	const run = await get_run(deps.db, run_id);
	if (!run.ok) return run;
	const target = run_target_of(run.value);
	if (target === null || target.kind !== "commit") {
		return err({
			kind: "conflict",
			resource: "pipeline_run",
			id: run_id,
			message: "redispatch applies only to external (commit-target) runs",
		} satisfies ServiceError);
	}
	const pkg = await get_package(deps.db, run.value.package_id);
	if (!pkg.ok) return pkg;
	const external_target = parse_external_target(pkg.value.external_target);
	if (!external_target.ok) return external_target;
	return redispatch_failed(deps, run.value, external_target.value, actor);
};

/**
 * Feed the DO's external-timeout alarm into the state machine: a run still
 * `deploying` with no newer progress becomes `unconfirmed` plus a
 * `timed_out` stage event for the record.
 */
export const tick_deploy_timeout = async (
	deps: RunDeps,
	run_id: string,
	plan: ResolvedPlan,
): Promise<Result<TransitionOutput, AdvanceError>> => {
	const before = await get_run(deps.db, run_id);
	const applied = await advance_run(deps, run_id, { kind: "deploy_timeout" }, plan);
	if (!applied.ok) return applied;
	const after = await get_run(deps.db, run_id);
	if (after.ok && before.ok && before.value.status !== after.value.status) {
		const timed_out = await record_stage_event_row(deps.db, {
			run_id,
			stage_name: after.value.current_stage ?? "staging",
			kind: "timed_out",
			payload: { stage: after.value.current_stage, sha: after.value.commit_sha },
		});
		if (!timed_out.ok) return timed_out;
	}
	return applied;
};

/**
 * Adopt an externally-ingested CI stage event for a run. Accepts the event
 * ONLY when the run is external (commit target), the reported stage is the
 * run's current stage, and the reported SHA matches the run's
 * `commit_sha`; otherwise a typed no-op reason is returned and nothing is
 * done. Orchestrated runs ignore external events entirely.
 */
export type ExternalEventInput = {
	event_kind: "deploy_completed" | "deploy_failed";
	stage_name: string;
	payload?: unknown;
};

export type ExternalEventNoOp = "orchestrated_run" | "malformed_payload" | "sha_mismatch" | "stage_mismatch";

export type ExternalEventOutcome =
	| { acted: true; output: TransitionOutput }
	| { acted: false; reason: ExternalEventNoOp; terminal: boolean };

const external_event_plan = async (deps: RunDeps, run: PipelineRun): Promise<Result<ResolvedPlan, AdvanceError>> => {
	const pkg = await get_package(deps.db, run.package_id);
	if (!pkg.ok) return pkg;
	const external_target = parse_external_target(pkg.value.external_target);
	if (!external_target.ok) {
		return err({
			kind: "validation_error",
			field: "external_target",
			message: `external run ${run.id} against a package without a valid external_target: ${external_target.error.message ?? ""}`,
		} satisfies ServiceError);
	}
	return ok(external_plan(external_target.value, run.commit_sha ?? "", run.kind));
};

const external_event_sha_of = (payload: unknown): Result<string, ExternalEventNoOp> => {
	if (payload === null || payload === undefined || typeof payload !== "object" || Array.isArray(payload)) {
		return err("malformed_payload");
	}
	const sha = (payload as Record<string, unknown>).sha;
	if (typeof sha !== "string" || sha.length === 0) return err("malformed_payload");
	return ok(sha);
};

export const apply_external_event = async (
	deps: RunDeps,
	run_id: string,
	input: ExternalEventInput,
): Promise<Result<ExternalEventOutcome, AdvanceError>> => {
	const run = await get_run(deps.db, run_id);
	if (!run.ok) return run;
	const target = run_target_of(run.value);
	if (target === null || target.kind !== "commit") {
		return ok({ acted: false, reason: "orchestrated_run", terminal: is_terminal_status(run.value.status) });
	}
	if (is_terminal_status(run.value.status)) {
		return ok({ acted: false, reason: "orchestrated_run", terminal: true });
	}
	const sha = external_event_sha_of(input.payload);
	if (!sha.ok) return ok({ acted: false, reason: sha.error, terminal: false });
	if (sha.value !== target.commit_sha) {
		return ok({ acted: false, reason: "sha_mismatch", terminal: false });
	}
	if (input.stage_name !== run.value.current_stage) {
		return ok({ acted: false, reason: "stage_mismatch", terminal: false });
	}
	const plan = await external_event_plan(deps, run.value);
	if (!plan.ok) return plan;

	const applied = await advance_run(
		deps,
		run_id,
		input.event_kind === "deploy_completed" ? { kind: "deploy_complete" } : { kind: "deploy_failed" },
		plan.value,
	);
	if (!applied.ok) return applied;
	return ok({ acted: true, output: applied.value });
};
