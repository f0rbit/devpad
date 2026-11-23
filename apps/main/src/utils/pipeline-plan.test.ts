import { describe, expect, test } from "bun:test";
import {
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
	version_set_id: null,
	commit_sha: "a".repeat(40),
	status: "awaiting_approval",
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

	test("accepts a JSON string defensively", () => {
		const read = read_gates(JSON.stringify(LIVE_EXTERNAL_RUN.resolved_gates));
		expect(read.ok).toBe(true);
		if (read.ok) {
			expect(read.value["staging→production"].type).toBe("manual");
		}
	});

	test("malformed object → typed error with reason, no throw", () => {
		const read = read_gates({ "staging→production": { type: "nonsense" } });
		expect(read.ok).toBe(false);
		if (!read.ok) expect(read.reason.length).toBeGreaterThan(0);
	});

	test("malformed JSON string → typed error", () => {
		const read = read_gates("{not json");
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

	test("accepts a JSON string defensively", () => {
		const read = read_rollout(JSON.stringify(LIVE_EXTERNAL_RUN.resolved_rollout));
		expect(read.ok).toBe(true);
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
		const progress = stages_for_run({ current_stage: "production", commit_sha: "a".repeat(40) }, read.value);
		expect(progress.stages).toEqual(["staging", "production"]);
		expect(progress.current_index).toBe(1);
	});

	test("orchestrated run whose current_stage is in the rollout keeps today's behaviour", () => {
		const read = read_rollout({ type: "gradual", stages: [{ name: "production", traffic: 100, bake: null }] });
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run({ current_stage: "production", commit_sha: null }, read.value);
		expect(progress.stages).toEqual(["production"]);
		expect(progress.current_index).toBe(0);
	});

	test("orchestrated run with current_stage missing from the rollout renders rollout stages unhighlighted", () => {
		const read = read_rollout(LIVE_EXTERNAL_RUN.resolved_rollout);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		const progress = stages_for_run({ current_stage: "staging", commit_sha: null }, read.value);
		expect(progress.stages).toEqual(["production"]);
		expect(progress.current_index).toBe(-1);
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
