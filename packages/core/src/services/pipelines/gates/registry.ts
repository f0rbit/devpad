import type { Gate } from "@devpad/pipeline-templates";
import { ManualGateEvaluator } from "./manual.js";
import { AutoGateEvaluator } from "./auto.js";
import { AnalysisGateEvaluator } from "./analysis.js";
import type { GateEvaluator, PulseEmitter, ApprovalStore } from "./evaluator.js";

export interface GateEvaluatorDeps {
	pulse: PulseEmitter;
	approvals: ApprovalStore;
}

export function gateEvaluatorFor(gate: Gate, deps: GateEvaluatorDeps): GateEvaluator {
	switch (gate.type) {
		case "manual":
			return new ManualGateEvaluator(deps.pulse, deps.approvals);
		case "auto":
			return new AutoGateEvaluator();
		case "analysis":
			return new AnalysisGateEvaluator(deps.pulse);
		default:
			const _exhaustive: never = gate;
			throw new Error(`Unknown gate type: ${_exhaustive}`);
	}
}
