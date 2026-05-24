/**
 * @module core/services/pipelines/state-machine
 *
 * Pure deterministic state machine for pipeline runs. Plain data in,
 * plain data out — no IO, no clock, no random, no DB. The companion
 * service (`runs.ts`) wraps this with side effects: persisting state,
 * dispatching to the gate-evaluator registry, calling Cloudflare, and
 * scheduling bake alarms.
 *
 * The state machine consumes the resolved `Stage[]` produced by
 * `expand_rollout(resolved_rollout)` at run start and never re-expands.
 * Every transition is total: a (state, event) pair either yields the next
 * state + a typed `TransitionOutput` for the wrapper to act on, or a
 * typed `TransitionError` describing why the transition is invalid.
 *
 * State columns map onto `pipeline_run.status` (string enum) plus two
 * pure-data fields that live alongside (`stage_index`, `last_deployed_index`)
 * — the wrapper persists those as derived values from `current_stage`.
 */

import type { Gate, Stage, TransitionKey } from "@devpad/pipeline-templates";
import type { RunStatus } from "@devpad/schema";
import { err, ok, type Result } from "@f0rbit/corpus";

/**
 * Resolved plan for an in-flight run. Snapshotted at run start onto
 * `pipeline_run.resolved_rollout` / `resolved_gates`; the state machine
 * reads from this snapshot, never the template.
 */
export type ResolvedPlan = {
	stages: Stage[];
	gates: Record<TransitionKey, Gate>;
	forced_reason: "do_migrations" | "asset_affinity_none" | null;
	version_set_id: string;
	previous_version_set_id: string | null;
};

/**
 * The mutable position of a run. `status` maps onto the D1 enum; the
 * indices are derived state that the wrapper persists as `current_stage`.
 *
 * - `stage_index` is the position of the *current target* stage in
 *   `plan.stages`. At run start it is 0 (staging).
 * - `last_deployed_index` is the highest stage index that has finished
 *   deploying. `null` before the first deploy completes.
 */
export type RunState = {
	status: RunStatus;
	stage_index: number;
	last_deployed_index: number | null;
};

/**
 * Inbound events to the state machine. Sources:
 *
 * - `start` — the run is created and the wrapper kicks it off.
 * - `deploy_complete` — the wrapper finished `deploy_stage` (success).
 * - `bake_complete` — a bake-window alarm fired.
 * - `gate_verdict` — the wrapper invoked a `GateEvaluator` (or received
 *   an external POST /approve) and is reporting the verdict back.
 * - `rollback_requested` — operator hit POST /rollback.
 * - `cancel` — operator hit POST /cancel.
 */
export type RunEvent = { kind: "start" } | { kind: "deploy_complete" } | { kind: "bake_complete" } | { kind: "gate_verdict"; verdict: "Pass" | "Fail" | "Pending"; reason?: string } | { kind: "rollback_requested" } | { kind: "cancel" };

/**
 * Side-effect commands the wrapper must execute after a transition. The
 * state machine itself never touches IO; it returns one of these so the
 * wrapper knows what to do next.
 *
 * - `needs_deploy` — the wrapper calls `deploy_stage(stage, version_set)`.
 *   On success it feeds back `deploy_complete`.
 * - `needs_bake_schedule` — the wrapper sets a DO alarm for
 *   `duration_ms` and on alarm fires `bake_complete`.
 * - `needs_gate_eval` — the wrapper calls the gate evaluator for
 *   `transition_key`. On verdict it fires `gate_verdict { verdict }`.
 * - `needs_rollback` — the wrapper calls `rollback_run`.
 * - `done` — the state has settled, nothing for the wrapper to do until
 *   the next external event (manual approval, alarm, etc.).
 */
export type TransitionOutput =
	| { kind: "needs_deploy"; stage: Stage; stage_index: number; version_set_id: string }
	| { kind: "needs_bake_schedule"; stage: Stage; stage_index: number; duration_ms: number }
	| { kind: "needs_gate_eval"; gate: Gate; transition_key: TransitionKey; from_stage: Stage; to_stage: Stage }
	| { kind: "needs_rollback"; previous_version_set_id: string }
	| { kind: "done" };

export type TransitionError =
	| { code: "invalid_event"; message: string; state: RunStatus; event: RunEvent["kind"] }
	| { code: "terminal_state"; message: string; state: RunStatus }
	| { code: "missing_gate"; message: string; transition_key: TransitionKey }
	| { code: "no_previous_version"; message: string }
	| { code: "empty_plan"; message: string };

export type TransitionResult = {
	next: RunState;
	emit: TransitionOutput;
};

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "rolled_back", "failed", "cancelled"]);

export const is_terminal_status = (status: RunStatus): boolean => TERMINAL.has(status);

const transition_key_for = (from: Stage, to: Stage): TransitionKey => `${from.name}→${to.name}` as TransitionKey;

const has_bake = (stage: Stage): boolean => stage.bake !== null && stage.bake.ms > 0;

const is_last_stage = (state: RunState, plan: ResolvedPlan): boolean => state.stage_index >= plan.stages.length - 1;

/**
 * Compute the next deploy step. After a Pass verdict (or directly from
 * the initial `start`), we advance `stage_index` and emit a deploy
 * command. The wrapper is responsible for persisting the new state and
 * actually calling Cloudflare.
 */
const advance_to_deploy = (state: RunState, plan: ResolvedPlan, next_index: number): TransitionResult => {
	const stage = plan.stages[next_index];
	return {
		next: { ...state, status: "deploying", stage_index: next_index },
		emit: { kind: "needs_deploy", stage, stage_index: next_index, version_set_id: plan.version_set_id },
	};
};

/**
 * After a successful deploy completes, decide the post-deploy action:
 *
 * 1. If this was the last stage in the plan → completed.
 * 2. If the *just-deployed* stage has a positive bake window → wait.
 * 3. Otherwise immediately request gate evaluation for the next transition.
 */
const post_deploy_step = (state: RunState, plan: ResolvedPlan): Result<TransitionResult, TransitionError> => {
	const deployed_index = state.stage_index;
	const updated_state: RunState = { ...state, last_deployed_index: deployed_index };

	if (deployed_index >= plan.stages.length - 1) {
		return ok({
			next: { ...updated_state, status: "completed" },
			emit: { kind: "done" },
		});
	}

	const deployed_stage = plan.stages[deployed_index];
	if (has_bake(deployed_stage)) {
		const bake_ms = deployed_stage.bake?.ms ?? 0;
		return ok({
			next: { ...updated_state, status: "baking" },
			emit: { kind: "needs_bake_schedule", stage: deployed_stage, stage_index: deployed_index, duration_ms: bake_ms },
		});
	}

	return request_gate_eval(updated_state, plan);
};

/**
 * Emit a `needs_gate_eval` for the transition out of the just-deployed /
 * just-baked stage. Sets state to `awaiting_approval` — that status is
 * shared between manual gates (which actually wait for human input) and
 * auto/analysis gates (which the wrapper resolves on the same tick by
 * immediately firing a `gate_verdict` event back).
 */
const request_gate_eval = (state: RunState, plan: ResolvedPlan): Result<TransitionResult, TransitionError> => {
	const from = plan.stages[state.stage_index];
	const to = plan.stages[state.stage_index + 1];
	const key = transition_key_for(from, to);
	const gate = plan.gates[key];
	if (gate === undefined) {
		return err({
			code: "missing_gate",
			message: `no gate registered for transition ${key}`,
			transition_key: key,
		});
	}
	return ok({
		next: { ...state, status: "awaiting_approval" },
		emit: { kind: "needs_gate_eval", gate, transition_key: key, from_stage: from, to_stage: to },
	});
};

/**
 * Pure transition function. Total over (state, event, plan): every
 * combination either advances to a well-defined next state with a typed
 * side-effect command, or returns a typed error explaining why the
 * event is invalid in the current state.
 *
 * The function is deterministic — same inputs always produce the same
 * output. No clock, no random, no IO. Tests cover every (state, event)
 * pair without spinning up Cloudflare or D1.
 */
export const transition = (state: RunState, event: RunEvent, plan: ResolvedPlan): Result<TransitionResult, TransitionError> => {
	if (plan.stages.length === 0) {
		return err({ code: "empty_plan", message: "resolved plan has no stages" });
	}

	if (event.kind === "cancel") {
		if (TERMINAL.has(state.status)) {
			return err({ code: "terminal_state", message: `cannot cancel from terminal state ${state.status}`, state: state.status });
		}
		return ok({
			next: { ...state, status: "cancelled" },
			emit: { kind: "done" },
		});
	}

	if (event.kind === "rollback_requested") {
		if (TERMINAL.has(state.status)) {
			return err({ code: "terminal_state", message: `cannot rollback from terminal state ${state.status}`, state: state.status });
		}
		if (plan.previous_version_set_id === null) {
			return err({ code: "no_previous_version", message: "no previous version set to roll back to" });
		}
		return ok({
			next: { ...state, status: "rolling_back" },
			emit: { kind: "needs_rollback", previous_version_set_id: plan.previous_version_set_id },
		});
	}

	if (TERMINAL.has(state.status)) {
		return err({ code: "terminal_state", message: `state ${state.status} is terminal`, state: state.status });
	}

	switch (state.status) {
		case "queued": {
			if (event.kind !== "start") {
				return err({ code: "invalid_event", message: `event ${event.kind} invalid in state queued`, state: state.status, event: event.kind });
			}
			return ok(advance_to_deploy(state, plan, 0));
		}

		case "deploying": {
			if (event.kind === "deploy_complete") {
				return post_deploy_step(state, plan);
			}
			return err({ code: "invalid_event", message: `event ${event.kind} invalid in state deploying`, state: state.status, event: event.kind });
		}

		case "baking": {
			if (event.kind !== "bake_complete") {
				return err({ code: "invalid_event", message: `event ${event.kind} invalid in state baking`, state: state.status, event: event.kind });
			}
			return request_gate_eval(state, plan);
		}

		case "awaiting_approval": {
			if (event.kind !== "gate_verdict") {
				return err({ code: "invalid_event", message: `event ${event.kind} invalid in state awaiting_approval`, state: state.status, event: event.kind });
			}
			if (event.verdict === "Pending") {
				return ok({ next: state, emit: { kind: "done" } });
			}
			if (event.verdict === "Fail") {
				return ok({
					next: { ...state, status: "failed" },
					emit: { kind: "done" },
				});
			}
			const next_index = state.stage_index + 1;
			if (next_index >= plan.stages.length) {
				return ok({
					next: { ...state, status: "completed" },
					emit: { kind: "done" },
				});
			}
			return ok(advance_to_deploy(state, plan, next_index));
		}

		case "rolling_back": {
			if (event.kind !== "deploy_complete") {
				return err({ code: "invalid_event", message: `event ${event.kind} invalid in state rolling_back`, state: state.status, event: event.kind });
			}
			return ok({
				next: { ...state, status: "rolled_back" },
				emit: { kind: "done" },
			});
		}

		default: {
			return err({ code: "invalid_event", message: `unhandled state ${state.status}`, state: state.status, event: event.kind });
		}
	}
};

/**
 * Convenience constructor — initial state for a freshly-created run.
 * Persist this onto `pipeline_run` at row insert time; the state machine
 * advances from here on `start`.
 */
export const initial_state = (): RunState => ({
	status: "queued",
	stage_index: 0,
	last_deployed_index: null,
});

export const transition_key = transition_key_for;
