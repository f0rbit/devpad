import { err, type Result } from "@f0rbit/corpus";
import type {
	CompleteError,
	CompleteResult,
	CompletionActor,
	CompletionEngine,
	ReopenError,
	ReopenResult,
} from "./completion.js";

/**
 * Recording fake for `CompletionEngine` (task A2.2) — consumer tests (routes,
 * hooks dispatch, UI-facing services) script the outcome per task id rather
 * than exercising the real guarded cascade. The cascade itself is tested
 * ONLY against real SQLite in `completion.ts`'s own suite — never through
 * this fake, per the plan's "Bubbling test seam" note.
 */
export class InMemoryCompletionEngine implements CompletionEngine {
	readonly complete_calls: { id: string; actor: CompletionActor; base_rev: number }[] = [];
	readonly reopen_calls: { id: string; actor: CompletionActor }[] = [];
	private readonly complete_script = new Map<string, Result<CompleteResult, CompleteError>>();
	private readonly reopen_script = new Map<string, Result<ReopenResult, ReopenError>>();

	script_complete(id: string, result: Result<CompleteResult, CompleteError>): void {
		this.complete_script.set(id, result);
	}

	script_reopen(id: string, result: Result<ReopenResult, ReopenError>): void {
		this.reopen_script.set(id, result);
	}

	async complete(id: string, actor: CompletionActor, base_rev: number): Promise<Result<CompleteResult, CompleteError>> {
		this.complete_calls.push({ id, actor, base_rev });
		const scripted = this.complete_script.get(id);
		if (scripted) return scripted;
		return err({ kind: "not_found", resource: "task", id });
	}

	async reopen(id: string, actor: CompletionActor): Promise<Result<ReopenResult, ReopenError>> {
		this.reopen_calls.push({ id, actor });
		const scripted = this.reopen_script.get(id);
		if (scripted) return scripted;
		return err({ kind: "not_found", resource: "task", id });
	}
}
