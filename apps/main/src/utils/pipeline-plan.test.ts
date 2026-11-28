import { describe, expect, test } from "bun:test";
import {
	decision_for_transition,
	GATE_READ_ERROR,
	gate_for_stage,
	read_gates,
	read_rollout,
	stages_for_run,
	target_stage_of,
} from "./pipeline-plan";

// The exact live run shape from the orchestrator (`GET /runs/:id`) that
// root-caused the production bug: external deploy run, `version_set_id`
// null, `commit_sha` set, awaiting the manual staging→production gate.
const LIVE_EXTERNAL_RUN = {
	kind: "deploy",
	status: "awaiting_approval",
	version_set_id: null,
	commit_sha: "a".repeat(40),
	current_stage: "staging",
	resolved_rollout: { type: "gradual", stages: [{ name: "production", traffic: 100, bake: null }] },
	resolved_gates: { "staging→production": { type: "manual" } },
};

describe("read_gates", () => {
	test("accepts the live object form", () => {
		const read = read_gates(LIVE_EXTERNAL_RUN.resolved_gates);
		expect(read.ok).toBe(true);
		if (read.ok) {
			const gate = gate_for_stage(read.value, "staging");
			expect(gate).not.toBeNull();
			expect(gate?.key).toBe("staging→production");
			expect(gate?.gate.type).toBe("manual");
		}
	});

	test("malformed object → typed error with reason, no throw", () => {
		const read = read_gates({ "staging→production": { type: "nonsense" } });
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.reason.length).toBeGreaterThan(0);
	});

	// The defensive JSON-string fallback was removed with verification-hardening
	// 2.1: the columns are typed end-to-end and Zod-validated at the core read
	// boundary, so a string on the wire is a bug — it must read as a failure,
	// not silently re-parse.
	test("a JSON string is no longer accepted — typed error", () => {
		const read = read_gates(JSON.stringify(LIVE_EXTERNAL_RUN.resolved_gates));
		expect(read.ok).toBe(false);
	});
});

describe("gate_for_stage", () => {
	test("prefers the transition out of the stage over a substring match", () => {
		const read = read_gates({
			"production→live": { type: "auto" },
			"staging→production": { type: "manual" },
		});
		expect(read.ok).toBe(true);
		if (read.ok) {
			expect(gate_for_stage(read.value, "production")?.key).toBe("production→live");
			expect(gate_for_stage(read.value, "staging")?.key).toBe("staging→production");
		}
	});

	test("returns null when no key matches", () => {
		const read = read_gates({ "production→live": { type: "auto" } });
		expect(read.ok).toBe(true);
		if (read.ok) expect(gate_for_stage(read.value, "staging")).toBeNull();
	});

	test("a historical verdict field survives the read", () => {
		const read = read_gates({ "staging→production": { type: "manual", verdict: "approved" } });
		expect(read.ok).toBe(true);
		if (read.ok) expect(gate_for_stage(read.value, "staging")?.gate.verdict).toBe("approved");
	});
});

describe("read_rollout", () => {
	test("accepts the live object form", () => {
		const read = read_rollout(LIVE_EXTERNAL_RUN.resolved_rollout);
		expect(read.ok).toBe(true);
		if (read.ok) expect(read.value.type).toBe("gradual");
	});

	test("a JSON string is no longer accepted — typed error", () => {
		const read = read_rollout(JSON.stringify(LIVE_EXTERNAL_RUN.resolved_rollout));
		expect(read.ok).toBe(false);
	});

	test("atomic rollout reads fine (no stages)", () => {
		const read = read_rollout({ type: "atomic" });
		expect(read.ok).toBe(true);
	});

	test("malformed → typed error", () => {
		const read = read_rollout({ type: "sideways" });
		expect(read.ok).toBe(false);
	});
});

describe("stages_for_run", () => {
	test("external awaiting_approval run renders staging → production with staging current", () => {
		const read = read_rollout(LIVE_EXTERNAL_RUN.resolved_rollout);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(LIVE_EXTERNAL_RUN, read.value);
		expect(progress.stages).toEqual(["staging", "production"]);
		expect(progress.current_index).toBe(0);
	});

	test("external run with atomic rollout still renders staging → production", () => {
		const read = read_rollout({ type: "atomic" });
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(
			{ current_stage: "production", commit_sha: "a".repeat(40), kind: "deploy", status: "deploying" },
			read.value,
		);
		expect(progress.stages).toEqual(["staging", "production"]);
		expect(progress.current_index).toBe(1);
	});

	test("external DEPLOY run at production keeps staging rendered as done", () => {
		const read = read_rollout(LIVE_EXTERNAL_RUN.resolved_rollout);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(
			{ current_stage: "production", commit_sha: "a".repeat(40), kind: "deploy", status: "deploying" },
			read.value,
		);
		expect(progress.stages).toEqual(["staging", "production"]);
		expect(progress.current_index).toBe(1);
	});

	test("external DEPLOY run completed renders every stage done", () => {
		const read = read_rollout(LIVE_EXTERNAL_RUN.resolved_rollout);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(
			{ current_stage: "production", commit_sha: "a".repeat(40), kind: "deploy", status: "completed" },
			read.value,
		);
		expect(progress.stages).toEqual(["staging", "production"]);
		expect(progress.done_count).toBe(2);
		expect(progress.current_index).toBe(-1);
	});

	test("external ROLLBACK run renders production only", () => {
		const read = read_rollout({ type: "atomic" });
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(
			{ current_stage: "production", commit_sha: "a".repeat(40), kind: "rollback", status: "deploying" },
			read.value,
		);
		expect(progress.stages).toEqual(["production"]);
		expect(progress.current_index).toBe(0);
	});

	test("orchestrated run whose current_stage is in the rollout keeps today's behaviour", () => {
		const read = read_rollout({ type: "gradual", stages: [{ name: "production", traffic: 100, bake: null }] });
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(
			{ current_stage: "production", commit_sha: null, kind: "deploy", status: "baking" },
			read.value,
		);
		expect(progress.stages).toEqual(["production"]);
		expect(progress.current_index).toBe(0);
	});

	test("orchestrated run with current_stage missing from the rollout renders rollout stages unhighlighted", () => {
		const read = read_rollout(LIVE_EXTERNAL_RUN.resolved_rollout);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run(
			{ current_stage: "staging", commit_sha: null, kind: "deploy", status: "queued" },
			read.value,
		);
		expect(progress.stages).toEqual(["production"]);
		expect(progress.current_index).toBe(-1);
	});
});

const verdict_event = (overrides: Record<string, unknown>): Record<string, unknown> => ({
	id: "pipeline-stage-event_x",
	run_id: "run_1",
	kind: "gate_verdict",
	stage_name: "production",
	ts: "2026-11-24T00:00:00.000Z",
	payload: {},
	...overrides,
});

describe("decision_for_transition", () => {
	test("returns null when no gate_verdict event exists for the stage", () => {
		const events = [verdict_event({ stage_name: "staging", payload: { verdict: "Pass" } })];
		expect(decision_for_transition(events, "production")).toBeNull();
	});

	test("returns null for a non-array / empty input", () => {
		expect(decision_for_transition(null, "production")).toBeNull();
		expect(decision_for_transition([], "production")).toBeNull();
	});

	test("Pass with actor parses decided_by / decided_at", () => {
		const events = [
			verdict_event({
				payload: { type: "manual", verdict: "Pass", decided_by: "user_1", decided_at: "2026-11-24T01:00:00.000Z" },
			}),
		];
		const decision = decision_for_transition(events, "production");
		expect(decision).not.toBeNull();
		expect(decision?.verdict).toBe("Pass");
		expect(decision?.decided_by).toBe("user_1");
		expect(decision?.decided_at).toBe("2026-11-24T01:00:00.000Z");
	});

	test("Fail with reason parses the reason", () => {
		const events = [verdict_event({ payload: { type: "manual", verdict: "Fail", reason: "looks dodgy" } })];
		const decision = decision_for_transition(events, "production");
		expect(decision?.verdict).toBe("Fail");
		expect(decision?.reason).toBe("looks dodgy");
	});

	test("old payload without decided_by/decided_at still parses (backward compatible)", () => {
		const events = [verdict_event({ payload: { type: "manual", verdict: "Pass", reason: undefined } })];
		const decision = decision_for_transition(events, "production");
		expect(decision?.verdict).toBe("Pass");
		expect(decision?.decided_by).toBeUndefined();
		expect(decision?.decided_at).toBeUndefined();
	});

	test("latest ts wins", () => {
		const events = [
			verdict_event({
				id: "old",
				ts: "2026-11-24T00:00:00.000Z",
				payload: { verdict: "Fail", reason: "first look" },
			}),
			verdict_event({
				id: "new",
				ts: "2026-11-24T02:00:00.000Z",
				payload: { verdict: "Pass", decided_by: "user_2", decided_at: "2026-11-24T02:00:00.000Z" },
			}),
		];
		const decision = decision_for_transition(events, "production");
		expect(decision?.verdict).toBe("Pass");
		expect(decision?.decided_by).toBe("user_2");
	});

	test("newest-first wire order with equal-ish ordering still picks by ts", () => {
		const events = [
			verdict_event({ id: "newest", ts: "2026-11-24T03:00:00.000Z", payload: { verdict: "Fail" } }),
			verdict_event({ id: "older", ts: "2026-11-24T01:00:00.000Z", payload: { verdict: "Pass" } }),
		];
		expect(decision_for_transition(events, "production")?.verdict).toBe("Fail");
	});

	test("events whose payload isn't a resolved verdict are skipped, not fatal", () => {
		const events = [
			verdict_event({ kind: "deploy_started", payload: { traffic: 100 } }),
			verdict_event({ payload: { verdict: "Pass", decided_by: "user_1" } }),
		];
		expect(decision_for_transition(events, "production")?.verdict).toBe("Pass");
	});
});

describe("target_stage_of", () => {
	test("extracts the transition target", () => {
		expect(target_stage_of("staging→production")).toBe("production");
	});

	test("malformed key → null", () => {
		expect(target_stage_of("staging")).toBeNull();
	});
});

describe("error constants", () => {
	test("the inline failure messages exist for component rendering", () => {
		expect(GATE_READ_ERROR).toContain("gate");
	});
});
