import { err, ok, type Result } from "@f0rbit/corpus";

/**
 * Structural match of `@devpad/core/services/pipelines/dispatch`'s
 * `DispatchInput` / `DispatchError` — declared locally so pipeline-fakes
 * stays dependency-free (core imports fakes, never the reverse).
 */
export type RecordedDispatch = {
	repo: string;
	workflow: string;
	ref: string;
	inputs: { stage: string; sha: string; run_id: string };
};

export class InMemoryDispatcher {
	readonly dispatched: RecordedDispatch[] = [];
	/** One-shot failure injector — the next dispatch call resolves with a Github-style error. */
	fail_next: string | null = null;

	dispatch_count_for(run_id: string, stage: string): number {
		return this.dispatched.filter((d) => d.inputs.run_id === run_id && d.inputs.stage === stage).length;
	}

	async dispatch(
		input: RecordedDispatch,
	): Promise<Result<void, { code: "not_found" | "validation" | "unauthorized" | "internal"; message: string }>> {
		if (this.fail_next !== null) {
			const message = this.fail_next;
			this.fail_next = null;
			return err({ code: "internal", message });
		}
		this.dispatched.push({ ...input });
		return ok(undefined);
	}
}
