import { describe, expect, test } from "bun:test";
import type { Gate, Stage, TransitionKey } from "@devpad/pipeline-templates";
import {
	initial_state,
	type ResolvedPlan,
	type RunEvent,
	type RunState,
	transition,
	transition_key,
} from "../../state-machine.js";

const stages_gradual: Stage[] = [
	{ name: "staging", traffic: 0, bake: null },
	{ name: "onebox", traffic: 1, bake: { ms: 30 * 60_000 } },
	{ name: "wave1", traffic: 10, bake: { ms: 60 * 60_000 } },
	{ name: "wave2", traffic: 50, bake: { ms: 120 * 60_000 } },
	{ name: "full", traffic: 100, bake: { ms: 0 } },
];

const gates_gradual: Record<TransitionKey, Gate> = {
	"staging→onebox": { type: "manual" },
	"onebox→wave1": { type: "auto", afterBake: true },
	"wave1→wave2": { type: "auto", afterBake: true },
	"wave2→full": { type: "auto", afterBake: true },
};

const stages_atomic: Stage[] = [
	{ name: "staging", traffic: 0, bake: null },
	{ name: "atomic-prod", traffic: 100, bake: null },
];

const gates_atomic: Record<TransitionKey, Gate> = {
	"staging→atomic-prod": { type: "manual" },
};

const stages_zero_bake: Stage[] = [
	{ name: "staging", traffic: 0, bake: null },
	{ name: "onebox", traffic: 1, bake: { ms: 0 } },
	{ name: "full", traffic: 100, bake: { ms: 0 } },
];

const gates_zero_bake: Record<TransitionKey, Gate> = {
	"staging→onebox": { type: "auto" },
	"onebox→full": { type: "auto" },
};

const plan_gradual = (): ResolvedPlan => ({
	stages: stages_gradual,
	gates: gates_gradual,
	forced_reason: null,
	version_set_id: "vs_v1",
	previous_version_set_id: "vs_v0",
});

const plan_atomic = (): ResolvedPlan => ({
	stages: stages_atomic,
	gates: gates_atomic,
	forced_reason: null,
	version_set_id: "vs_v1",
	previous_version_set_id: "vs_v0",
});

const plan_zero_bake = (): ResolvedPlan => ({
	stages: stages_zero_bake,
	gates: gates_zero_bake,
	forced_reason: null,
	version_set_id: "vs_v1",
	previous_version_set_id: "vs_v0",
});

const plan_no_prev = (): ResolvedPlan => ({ ...plan_gradual(), previous_version_set_id: null });

const apply = (state: RunState, event: RunEvent, plan: ResolvedPlan = plan_gradual()) => {
	const r = transition(state, event, plan);
	if (!r.ok) throw new Error(`unexpected transition error: ${JSON.stringify(r.error)}`);
	return r.value;
};

describe("state-machine: transition_key helper", () => {
	test("formats transition keys as `from→to`", () => {
		expect(transition_key(stages_gradual[0], stages_gradual[1])).toBe("staging→onebox");
	});
});

describe("state-machine: initial_state", () => {
	test("produces a queued run at stage 0 with no deploys done", () => {
		expect(initial_state()).toEqual({ status: "queued", stage_index: 0, last_deployed_index: null });
	});
});

describe("state-machine: queued + start", () => {
	test("advances to deploying stage 0 with a needs_deploy command (gradual)", () => {
		const r = apply(initial_state(), { kind: "start" });
		expect(r.next).toEqual({ status: "deploying", stage_index: 0, last_deployed_index: null });
		expect(r.emit.kind).toBe("needs_deploy");
		if (r.emit.kind === "needs_deploy") {
			expect(r.emit.stage.name).toBe("staging");
			expect(r.emit.stage_index).toBe(0);
			expect(r.emit.version_set_id).toBe("vs_v1");
		}
	});

	test("advances to deploying stage 0 (atomic)", () => {
		const r = apply(initial_state(), { kind: "start" }, plan_atomic());
		expect(r.next.stage_index).toBe(0);
		expect(r.emit.kind).toBe("needs_deploy");
		if (r.emit.kind === "needs_deploy") expect(r.emit.stage.name).toBe("staging");
	});

	test("non-start event in queued is invalid", () => {
		for (const ev of [
			{ kind: "deploy_complete" as const },
			{ kind: "bake_complete" as const },
			{ kind: "gate_verdict" as const, verdict: "Pass" as const },
		]) {
			const r = transition(initial_state(), ev, plan_gradual());
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("invalid_event");
		}
	});
});

describe("state-machine: deploying + deploy_complete", () => {
	test("staging with bake-less next still requests gate eval directly (no bake on staging)", () => {
		const s: RunState = { status: "deploying", stage_index: 0, last_deployed_index: null };
		const r = apply(s, { kind: "deploy_complete" });
		expect(r.next.status).toBe("awaiting_approval");
		expect(r.next.last_deployed_index).toBe(0);
		expect(r.emit.kind).toBe("needs_gate_eval");
		if (r.emit.kind === "needs_gate_eval") {
			expect(r.emit.transition_key).toBe("staging→onebox");
			expect(r.emit.gate).toEqual({ type: "manual" });
		}
	});

	test("intermediate stage with bake > 0 schedules bake", () => {
		const s: RunState = { status: "deploying", stage_index: 1, last_deployed_index: 0 };
		const r = apply(s, { kind: "deploy_complete" });
		expect(r.next.status).toBe("baking");
		expect(r.next.last_deployed_index).toBe(1);
		expect(r.emit.kind).toBe("needs_bake_schedule");
		if (r.emit.kind === "needs_bake_schedule") {
			expect(r.emit.duration_ms).toBe(30 * 60_000);
			expect(r.emit.stage.name).toBe("onebox");
		}
	});

	test("intermediate stage with zero bake jumps straight to gate eval", () => {
		const s: RunState = { status: "deploying", stage_index: 1, last_deployed_index: 0 };
		const r = apply(s, { kind: "deploy_complete" }, plan_zero_bake());
		expect(r.next.status).toBe("awaiting_approval");
		expect(r.emit.kind).toBe("needs_gate_eval");
	});

	test("last stage completes with done", () => {
		const last_idx = stages_gradual.length - 1;
		const s: RunState = { status: "deploying", stage_index: last_idx, last_deployed_index: last_idx - 1 };
		const r = apply(s, { kind: "deploy_complete" });
		expect(r.next.status).toBe("completed");
		expect(r.next.last_deployed_index).toBe(last_idx);
		expect(r.emit.kind).toBe("done");
	});

	test("atomic last stage completes", () => {
		const s: RunState = { status: "deploying", stage_index: 1, last_deployed_index: 0 };
		const r = apply(s, { kind: "deploy_complete" }, plan_atomic());
		expect(r.next.status).toBe("completed");
		expect(r.emit.kind).toBe("done");
	});

	test("non-deploy events in deploying are invalid", () => {
		const s: RunState = { status: "deploying", stage_index: 0, last_deployed_index: null };
		for (const ev of [
			{ kind: "bake_complete" as const },
			{ kind: "gate_verdict" as const, verdict: "Pass" as const },
			{ kind: "start" as const },
		]) {
			const r = transition(s, ev, plan_gradual());
			expect(r.ok).toBe(false);
		}
	});
});

describe("state-machine: baking + bake_complete", () => {
	test("transitions to awaiting_approval with needs_gate_eval", () => {
		const s: RunState = { status: "baking", stage_index: 1, last_deployed_index: 1 };
		const r = apply(s, { kind: "bake_complete" });
		expect(r.next.status).toBe("awaiting_approval");
		expect(r.emit.kind).toBe("needs_gate_eval");
		if (r.emit.kind === "needs_gate_eval") {
			expect(r.emit.transition_key).toBe("onebox→wave1");
			expect(r.emit.gate).toEqual({ type: "auto", afterBake: true });
		}
	});

	test("non-bake event in baking is invalid", () => {
		const s: RunState = { status: "baking", stage_index: 1, last_deployed_index: 1 };
		const r = transition(s, { kind: "deploy_complete" }, plan_gradual());
		expect(r.ok).toBe(false);
	});
});

describe("state-machine: awaiting_approval + gate_verdict", () => {
	test("Pass advances to deploying next stage", () => {
		const s: RunState = { status: "awaiting_approval", stage_index: 0, last_deployed_index: 0 };
		const r = apply(s, { kind: "gate_verdict", verdict: "Pass" });
		expect(r.next.status).toBe("deploying");
		expect(r.next.stage_index).toBe(1);
		expect(r.emit.kind).toBe("needs_deploy");
		if (r.emit.kind === "needs_deploy") expect(r.emit.stage.name).toBe("onebox");
	});

	test("Pass on the second-to-last stage advances to last", () => {
		const s: RunState = { status: "awaiting_approval", stage_index: 3, last_deployed_index: 3 };
		const r = apply(s, { kind: "gate_verdict", verdict: "Pass" });
		expect(r.next.status).toBe("deploying");
		expect(r.next.stage_index).toBe(4);
		if (r.emit.kind === "needs_deploy") expect(r.emit.stage.name).toBe("full");
	});

	test("Pending keeps state and emits done", () => {
		const s: RunState = { status: "awaiting_approval", stage_index: 0, last_deployed_index: 0 };
		const r = apply(s, { kind: "gate_verdict", verdict: "Pending" });
		expect(r.next).toEqual(s);
		expect(r.emit.kind).toBe("done");
	});

	test("Fail terminates the run", () => {
		const s: RunState = { status: "awaiting_approval", stage_index: 0, last_deployed_index: 0 };
		const r = apply(s, { kind: "gate_verdict", verdict: "Fail", reason: "denied" });
		expect(r.next.status).toBe("failed");
		expect(r.emit.kind).toBe("done");
	});

	test("non-gate-verdict in awaiting_approval is invalid", () => {
		const s: RunState = { status: "awaiting_approval", stage_index: 0, last_deployed_index: 0 };
		for (const ev of [
			{ kind: "deploy_complete" as const },
			{ kind: "bake_complete" as const },
			{ kind: "start" as const },
		]) {
			const r = transition(s, ev, plan_gradual());
			expect(r.ok).toBe(false);
		}
	});
});

describe("state-machine: rollback_requested", () => {
	test("from any non-terminal state transitions to rolling_back", () => {
		const states: RunState[] = [
			{ status: "queued", stage_index: 0, last_deployed_index: null },
			{ status: "deploying", stage_index: 1, last_deployed_index: 0 },
			{ status: "baking", stage_index: 1, last_deployed_index: 1 },
			{ status: "awaiting_approval", stage_index: 2, last_deployed_index: 2 },
		];
		for (const s of states) {
			const r = apply(s, { kind: "rollback_requested" });
			expect(r.next.status).toBe("rolling_back");
			expect(r.emit.kind).toBe("needs_rollback");
			if (r.emit.kind === "needs_rollback") expect(r.emit.previous_version_set_id).toBe("vs_v0");
		}
	});

	test("rejected if there is no previous version", () => {
		const s: RunState = { status: "baking", stage_index: 1, last_deployed_index: 1 };
		const r = transition(s, { kind: "rollback_requested" }, plan_no_prev());
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("no_previous_version");
	});

	test("rejected from terminal states", () => {
		for (const status of ["completed", "rolled_back", "failed", "cancelled"] as const) {
			const s: RunState = { status, stage_index: 4, last_deployed_index: 4 };
			const r = transition(s, { kind: "rollback_requested" }, plan_gradual());
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("terminal_state");
		}
	});
});

describe("state-machine: rolling_back + deploy_complete", () => {
	test("transitions to rolled_back done", () => {
		const s: RunState = { status: "rolling_back", stage_index: 2, last_deployed_index: 2 };
		const r = apply(s, { kind: "deploy_complete" });
		expect(r.next.status).toBe("rolled_back");
		expect(r.emit.kind).toBe("done");
	});

	test("non-deploy event in rolling_back is invalid", () => {
		const s: RunState = { status: "rolling_back", stage_index: 2, last_deployed_index: 2 };
		const r = transition(s, { kind: "bake_complete" }, plan_gradual());
		expect(r.ok).toBe(false);
	});
});

describe("state-machine: cancel", () => {
	test("from non-terminal states transitions to cancelled", () => {
		const states: RunState[] = [
			{ status: "queued", stage_index: 0, last_deployed_index: null },
			{ status: "deploying", stage_index: 0, last_deployed_index: null },
			{ status: "baking", stage_index: 1, last_deployed_index: 1 },
			{ status: "awaiting_approval", stage_index: 0, last_deployed_index: 0 },
			{ status: "rolling_back", stage_index: 2, last_deployed_index: 2 },
		];
		for (const s of states) {
			const r = apply(s, { kind: "cancel" });
			expect(r.next.status).toBe("cancelled");
			expect(r.emit.kind).toBe("done");
		}
	});

	test("rejected from terminal states", () => {
		for (const status of ["completed", "rolled_back", "failed", "cancelled"] as const) {
			const s: RunState = { status, stage_index: 4, last_deployed_index: 4 };
			const r = transition(s, { kind: "cancel" }, plan_gradual());
			expect(r.ok).toBe(false);
		}
	});
});

describe("state-machine: terminal states reject most events", () => {
	test("completed rejects start / deploy_complete / bake / gate_verdict", () => {
		const s: RunState = { status: "completed", stage_index: 4, last_deployed_index: 4 };
		for (const ev of [
			{ kind: "start" as const },
			{ kind: "deploy_complete" as const },
			{ kind: "bake_complete" as const },
			{ kind: "gate_verdict" as const, verdict: "Pass" as const },
		]) {
			const r = transition(s, ev, plan_gradual());
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.error.code).toBe("terminal_state");
		}
	});
});

describe("state-machine: error cases", () => {
	test("empty plan stages returns empty_plan", () => {
		const empty_plan: ResolvedPlan = {
			stages: [],
			gates: {} as Record<TransitionKey, Gate>,
			forced_reason: null,
			version_set_id: "vs_v1",
			previous_version_set_id: null,
		};
		const r = transition(initial_state(), { kind: "start" }, empty_plan);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("empty_plan");
	});

	test("missing gate for transition surfaces missing_gate", () => {
		const plan: ResolvedPlan = {
			stages: stages_gradual,
			gates: { "staging→onebox": { type: "manual" } } as Record<TransitionKey, Gate>,
			forced_reason: null,
			version_set_id: "vs_v1",
			previous_version_set_id: null,
		};
		const s: RunState = { status: "baking", stage_index: 1, last_deployed_index: 1 };
		const r = transition(s, { kind: "bake_complete" }, plan);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("missing_gate");
	});
});

describe("state-machine: end-to-end script — full gradual happy path", () => {
	test("queued → deploying → awaiting → ...→ completed via Pass verdicts", () => {
		const plan = plan_gradual();
		let state = initial_state();
		const events: RunEvent[] = [
			{ kind: "start" },
			{ kind: "deploy_complete" }, // staging done -> awaiting (manual)
			{ kind: "gate_verdict", verdict: "Pass" }, // onebox deploy
			{ kind: "deploy_complete" }, // onebox done -> baking
			{ kind: "bake_complete" }, // -> awaiting (auto)
			{ kind: "gate_verdict", verdict: "Pass" }, // wave1 deploy
			{ kind: "deploy_complete" }, // baking
			{ kind: "bake_complete" }, // awaiting (auto)
			{ kind: "gate_verdict", verdict: "Pass" }, // wave2 deploy
			{ kind: "deploy_complete" }, // baking
			{ kind: "bake_complete" }, // awaiting (auto)
			{ kind: "gate_verdict", verdict: "Pass" }, // full deploy
			{ kind: "deploy_complete" }, // completed
		];
		for (const ev of events) {
			const r = transition(state, ev, plan);
			expect(r.ok).toBe(true);
			if (r.ok) state = r.value.next;
		}
		expect(state.status).toBe("completed");
		expect(state.stage_index).toBe(4);
		expect(state.last_deployed_index).toBe(4);
	});
});

describe("state-machine: end-to-end script — atomic happy path", () => {
	test("queued → deploying(staging) → awaiting → deploying(atomic-prod) → completed", () => {
		const plan = plan_atomic();
		let state = initial_state();
		const events: RunEvent[] = [
			{ kind: "start" },
			{ kind: "deploy_complete" }, // staging -> awaiting (manual on staging→atomic-prod)
			{ kind: "gate_verdict", verdict: "Pass" }, // deploy atomic-prod
			{ kind: "deploy_complete" }, // completed
		];
		for (const ev of events) {
			const r = transition(state, ev, plan);
			expect(r.ok).toBe(true);
			if (r.ok) state = r.value.next;
		}
		expect(state.status).toBe("completed");
	});
});

describe("state-machine: gate Fail aborts the run", () => {
	test("Fail at staging→onebox leaves state failed", () => {
		const plan = plan_gradual();
		let state = initial_state();
		state = transition(state, { kind: "start" }, plan).value!.next as RunState;
		state = transition(state, { kind: "deploy_complete" }, plan).value!.next as RunState;
		const r = transition(state, { kind: "gate_verdict", verdict: "Fail", reason: "denied" }, plan);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.next.status).toBe("failed");
			expect(r.value.emit.kind).toBe("done");
		}
	});
});

describe("state-machine: mid-rollout rollback", () => {
	test("rollback_requested mid-bake → rolling_back → rolled_back", () => {
		const plan = plan_gradual();
		const mid: RunState = { status: "baking", stage_index: 2, last_deployed_index: 2 };
		const r1 = apply(mid, { kind: "rollback_requested" }, plan);
		expect(r1.next.status).toBe("rolling_back");
		expect(r1.emit.kind).toBe("needs_rollback");

		const r2 = apply(r1.next, { kind: "deploy_complete" }, plan);
		expect(r2.next.status).toBe("rolled_back");
		expect(r2.emit.kind).toBe("done");
	});
});
