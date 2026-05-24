import type { GateVerdict, StageContext } from "@devpad/pipeline-templates";
import type { Result } from "@f0rbit/corpus";
import { err, ok, pipe } from "@f0rbit/corpus";
import type { ApprovalStore, EmitError, GateError, GateEvaluator, PulseEmitter, StoreError } from "./evaluator.js";

export class ManualGateEvaluator implements GateEvaluator {
	private pulse: PulseEmitter;
	private approvals: ApprovalStore;

	constructor(pulse: PulseEmitter, approvals: ApprovalStore) {
		this.pulse = pulse;
		this.approvals = approvals;
	}

	async evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>> {
		const decision = await this.approvals.read_decision(ctx.run_id, ctx.to_stage);

		if (!decision.ok) {
			return decision as Result<never, GateError>;
		}

		if (decision.value === null) {
			const pending_write = await this.approvals.write_pending(ctx.run_id, ctx.to_stage);
			if (!pending_write.ok) {
				return pending_write as Result<never, GateError>;
			}

			const pulse_emit = await this.pulse.emit({
				event: "gate_pending_manual",
				run_id: ctx.run_id,
				stage: ctx.to_stage,
			});

			if (!pulse_emit.ok) {
				return pulse_emit as Result<never, GateError>;
			}

			return ok({ verdict: "Pending" as const });
		}

		if (decision.value === "approved") {
			return ok({ verdict: "Pass" as const });
		}

		return ok({
			verdict: "Fail" as const,
			reason: "Manual approval denied",
		});
	}
}
