import { ok } from "@f0rbit/corpus";
import type { StageContext, GateVerdict } from "@devpad/pipeline-templates";
import type { GateEvaluator, GateError } from "./evaluator.js";
import type { Result } from "@f0rbit/corpus";

export function decide_auto(_ctx: StageContext): GateVerdict {
	return { verdict: "Pass" };
}

export class AutoGateEvaluator implements GateEvaluator {
	async evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>> {
		return ok(decide_auto(ctx));
	}
}
