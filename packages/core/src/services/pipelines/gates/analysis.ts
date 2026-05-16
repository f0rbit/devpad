import { ok, pipe } from "@f0rbit/corpus";
import type { StageContext, GateVerdict } from "@devpad/pipeline-templates";
import type { GateEvaluator, PulseEmitter, GateError } from "./evaluator.js";
import type { Result } from "@f0rbit/corpus";

export class AnalysisGateEvaluator implements GateEvaluator {
	private pulse: PulseEmitter;

	constructor(pulse: PulseEmitter) {
		this.pulse = pulse;
	}

	async evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>> {
		if (ctx.gate.type !== "analysis") {
			return ok({ verdict: "Pass" as const, reason: "invalid gate type" });
		}

		return pipe(
			this.pulse.emit({
				event: "gate_analysis_stub",
				run_id: ctx.run_id,
				stage: ctx.to_stage,
				template: ctx.gate.template,
			})
		)
			.map(() => ({ verdict: "Pass" as const, reason: "stub" }))
			.result();
	}
}
