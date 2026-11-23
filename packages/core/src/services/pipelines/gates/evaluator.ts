import type { GateVerdict, StageContext } from "@devpad/pipeline-templates";
import type { Result } from "@f0rbit/corpus";

export type EmitError = {
	kind: "emit_error";
	message?: string;
};

export type StoreError = {
	kind: "store_error";
	operation: string;
	message?: string;
};

export type GateError = EmitError | StoreError;

export type PulseEmitter = {
	emit(event: PulseEvent): Promise<Result<void, EmitError>>;
};

export type ApprovalStore = {
	write_pending(run_id: string, stage: string, scope?: string): Promise<Result<void, StoreError>>;
	read_decision(run_id: string, stage: string): Promise<Result<Decision | null, StoreError>>;
	/**
	 * THE only writer of `pipeline_approval` rows. `decided_by` must be a
	 * real user id — the column carries a FOREIGN KEY to `user.id`, so a
	 * sentinel string ("system", "auto") fails on D1. Callers that have a
	 * human actor (approve/redispatch routes) MUST pass it; the store owns
	 * the insert.
	 */
	write_decision(
		run_id: string,
		stage: string,
		decision: Decision,
		decided_by: string,
		reason?: string,
	): Promise<Result<void, StoreError>>;
};

export type PulseEvent =
	| {
			event: "gate_pending_manual";
			run_id: string;
			stage: string;
	  }
	| {
			event: "gate_analysis_verdict";
			run_id: string;
			stage: string;
			template: { template_id: string };
			verdict: "Pass" | "Fail" | "Pending";
			reason?: string;
	  }
	| {
			event: "gate_analysis_no_template";
			run_id: string;
			stage: string;
			template_id: string;
			reason: "no_template_auto_pass";
	  };

export type Decision = "approved" | "denied";

export type GateEvaluator = {
	evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>>;
};
