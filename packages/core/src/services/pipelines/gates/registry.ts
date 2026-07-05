import type { PulseSummaryProvider } from "@devpad/pipeline-fakes/pulse-summary";
import type { Gate } from "@devpad/pipeline-templates";
import type { Database } from "@devpad/schema/database/types";
import { AnalysisGateEvaluator } from "./analysis.js";
import { AutoGateEvaluator } from "./auto.js";
import type { ApprovalStore, GateEvaluator, PulseEmitter } from "./evaluator.js";
import { ManualGateEvaluator } from "./manual.js";

export interface GateEvaluatorDeps {
	pulse: PulseEmitter;
	approvals: ApprovalStore;
	db?: Database;
	pulse_summary?: PulseSummaryProvider;
	now?: () => number;
}

export function gateEvaluatorFor(gate: Gate, deps: GateEvaluatorDeps): GateEvaluator {
	switch (gate.type) {
		case "manual":
			return new ManualGateEvaluator(deps.pulse, deps.approvals);
		case "auto":
			return new AutoGateEvaluator();
		case "analysis": {
			if (!deps.db || !deps.pulse_summary) {
				throw new Error("Analysis gate requires `db` and `pulse_summary` in GateEvaluatorDeps");
			}
			return new AnalysisGateEvaluator({
				db: deps.db,
				pulse: deps.pulse,
				pulse_summary: deps.pulse_summary,
				now: deps.now,
			});
		}
		default: {
			const exhaustive_check: never = gate;
			throw new Error(`Unknown gate type: ${exhaustive_check}`);
		}
	}
}
