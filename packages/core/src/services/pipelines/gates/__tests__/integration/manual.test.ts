import { describe, test, expect, beforeEach } from "bun:test";
import { ManualGateEvaluator } from "../../manual.js";
import { InMemoryPulseEmitter, InMemoryApprovalStore } from "../helpers.js";
import type { StageContext } from "@devpad/pipeline-templates";

describe("ManualGateEvaluator", () => {
	let pulse: InMemoryPulseEmitter;
	let approvals: InMemoryApprovalStore;
	let evaluator: ManualGateEvaluator;

	const ctx: StageContext = {
		run_id: "run_123",
		package: "my-package",
		version_set_id: "vs_456",
		from_stage: "staging",
		to_stage: "onebox",
		gate: { type: "manual" },
	};

	beforeEach(() => {
		pulse = new InMemoryPulseEmitter();
		approvals = new InMemoryApprovalStore();
		evaluator = new ManualGateEvaluator(pulse, approvals);
	});

	test("first evaluation returns Pending and emits event", async () => {
		const result = await evaluator.evaluate(ctx);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.verdict).toBe("Pending");
		}

		expect(approvals.isPending(ctx.run_id, ctx.to_stage)).toBe(true);
		expect(pulse.emitted).toHaveLength(1);
		expect(pulse.emitted[0].event).toBe("gate_pending_manual");
	});

	test("returns Pass after approval", async () => {
		await evaluator.evaluate(ctx);
		approvals.setDecision(ctx.run_id, ctx.to_stage, "approved");

		const result = await evaluator.evaluate(ctx);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.verdict).toBe("Pass");
		}
	});

	test("returns Fail after denial", async () => {
		await evaluator.evaluate(ctx);
		approvals.setDecision(ctx.run_id, ctx.to_stage, "denied");

		const result = await evaluator.evaluate(ctx);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.verdict).toBe("Fail");
			expect(result.value.reason).toBe("Manual approval denied");
		}
	});

	test("returns Pending again if decision still null", async () => {
		const result1 = await evaluator.evaluate(ctx);
		expect(result1.ok).toBe(true);
		if (result1.ok) {
			expect(result1.value.verdict).toBe("Pending");
		}

		const result2 = await evaluator.evaluate(ctx);
		expect(result2.ok).toBe(true);
		if (result2.ok) {
			expect(result2.value.verdict).toBe("Pending");
		}

		expect(pulse.emitted).toHaveLength(2);
	});
});
