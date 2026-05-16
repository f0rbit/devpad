import { beforeEach, describe, expect, test } from "bun:test";
import type { StageContext } from "@devpad/pipeline-templates";
import { AnalysisGateEvaluator } from "../../analysis.js";
import { InMemoryPulseEmitter } from "../helpers.js";

describe("AnalysisGateEvaluator", () => {
	let pulse: InMemoryPulseEmitter;
	let evaluator: AnalysisGateEvaluator;

	const ctx: StageContext = {
		run_id: "run_123",
		package: "my-package",
		version_set_id: "vs_456",
		from_stage: "wave1",
		to_stage: "wave2",
		gate: { type: "analysis", template: { template_id: "at_789" } },
	};

	beforeEach(() => {
		pulse = new InMemoryPulseEmitter();
		evaluator = new AnalysisGateEvaluator(pulse);
	});

	test("returns Pass and emits gate_analysis_stub event", async () => {
		const result = await evaluator.evaluate(ctx);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.verdict).toBe("Pass");
			expect(result.value.reason).toBe("stub");
		}

		expect(pulse.emitted).toHaveLength(1);
		const event = pulse.emitted[0];
		expect(event.event).toBe("gate_analysis_stub");
		if (event.event === "gate_analysis_stub") {
			expect(event.run_id).toBe(ctx.run_id);
			expect(event.stage).toBe(ctx.to_stage);
			expect(event.template.template_id).toBe("at_789");
		}
	});

	test("pulse event includes correct template reference", async () => {
		const customCtx: StageContext = {
			...ctx,
			gate: { type: "analysis", template: { template_id: "custom_template_id" } },
		};

		await evaluator.evaluate(customCtx);

		expect(pulse.emitted).toHaveLength(1);
		const event = pulse.emitted[0];
		if (event.event === "gate_analysis_stub") {
			expect(event.template.template_id).toBe("custom_template_id");
		}
	});
});
