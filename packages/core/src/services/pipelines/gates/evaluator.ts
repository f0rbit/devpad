import type { Gate, GateVerdict, StageContext } from "@devpad/pipeline-templates";
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

export interface PulseEmitter {
	emit(event: PulseEvent): Promise<Result<void, EmitError>>;
}

export interface ApprovalStore {
	write_pending(run_id: string, stage: string, scope?: string): Promise<Result<void, StoreError>>;
	read_decision(run_id: string, stage: string): Promise<Result<Decision | null, StoreError>>;
}

export type PulseEvent =
	| {
			event: "gate_pending_manual";
			run_id: string;
			stage: string;
	  }
	| {
			event: "gate_analysis_stub";
			run_id: string;
			stage: string;
			template: { template_id: string };
	  };

export type Decision = "approved" | "denied";

export interface GateEvaluator {
	evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>>;
}
