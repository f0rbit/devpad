import { beforeEach, describe, expect, test } from "bun:test";
import type { Gate } from "@devpad/pipeline-templates";
import { AnalysisGateEvaluator } from "../../analysis.js";
import { AutoGateEvaluator } from "../../auto.js";
import { ManualGateEvaluator } from "../../manual.js";
import { gateEvaluatorFor } from "../../registry.js";
import { InMemoryApprovalStore, InMemoryPulseEmitter } from "../helpers.js";

describe("gateEvaluatorFor", () => {
	let pulse: InMemoryPulseEmitter;
	let approvals: InMemoryApprovalStore;

	beforeEach(() => {
		pulse = new InMemoryPulseEmitter();
		approvals = new InMemoryApprovalStore();
	});

	test("returns ManualGateEvaluator for manual gate", () => {
		const gate: Gate = { type: "manual" };
		const evaluator = gateEvaluatorFor(gate, { pulse, approvals });

		expect(evaluator).toBeInstanceOf(ManualGateEvaluator);
	});

	test("returns AutoGateEvaluator for auto gate", () => {
		const gate: Gate = { type: "auto" };
		const evaluator = gateEvaluatorFor(gate, { pulse, approvals });

		expect(evaluator).toBeInstanceOf(AutoGateEvaluator);
	});

	test("returns AutoGateEvaluator for auto gate with afterBake", () => {
		const gate: Gate = { type: "auto", afterBake: true };
		const evaluator = gateEvaluatorFor(gate, { pulse, approvals });

		expect(evaluator).toBeInstanceOf(AutoGateEvaluator);
	});

	test("returns AnalysisGateEvaluator for analysis gate", () => {
		const gate: Gate = { type: "analysis", template: { template_id: "at_123" } };
		const evaluator = gateEvaluatorFor(gate, { pulse, approvals });

		expect(evaluator).toBeInstanceOf(AnalysisGateEvaluator);
	});

	test("throws on unknown gate type", () => {
		const gate = { type: "unknown" } as unknown as Gate;

		expect(() => {
			gateEvaluatorFor(gate, { pulse, approvals });
		}).toThrow();
	});
});
