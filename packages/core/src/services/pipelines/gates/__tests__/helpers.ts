import type { Result } from "@f0rbit/corpus";
import { ok } from "@f0rbit/corpus";
import type { ApprovalStore, Decision, EmitError, PulseEmitter, PulseEvent, StoreError } from "../evaluator.js";

export class InMemoryPulseEmitter implements PulseEmitter {
	emitted: PulseEvent[] = [];

	async emit(event: PulseEvent): Promise<Result<void, EmitError>> {
		this.emitted.push(event);
		return ok(undefined);
	}
}

export class InMemoryApprovalStore implements ApprovalStore {
	private decisions: Map<string, Decision> = new Map();
	private pending: Set<string> = new Set();

	async write_pending(run_id: string, stage: string, _scope?: string): Promise<Result<void, StoreError>> {
		const key = `${run_id}:${stage}`;
		this.pending.add(key);
		return ok(undefined);
	}

	async read_decision(run_id: string, stage: string): Promise<Result<Decision | null, StoreError>> {
		const key = `${run_id}:${stage}`;
		const decision = this.decisions.get(key);
		return ok(decision ?? null);
	}

	async write_decision(run_id: string, stage: string, decision: Decision): Promise<Result<void, StoreError>> {
		const key = `${run_id}:${stage}`;
		this.decisions.set(key, decision);
		return ok(undefined);
	}

	setDecision(run_id: string, stage: string, decision: Decision): void {
		const key = `${run_id}:${stage}`;
		this.decisions.set(key, decision);
	}

	isPending(run_id: string, stage: string): boolean {
		const key = `${run_id}:${stage}`;
		return this.pending.has(key);
	}
}
