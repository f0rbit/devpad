import type { GateVerdict, StageContext } from "@devpad/pipeline-templates";
import type { Result } from "@f0rbit/corpus";
import { ok } from "@f0rbit/corpus";
import type { GateError, GateEvaluator } from "./evaluator.js";

export function decide_auto(_ctx: StageContext): GateVerdict {
	return { verdict: "Pass" };
}

export class AutoGateEvaluator implements GateEvaluator {
	async evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>> {
		return ok(decide_auto(ctx));
	}
}
