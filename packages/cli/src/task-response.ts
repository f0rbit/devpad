import { z } from "zod";

/**
 * @module @devpad/cli/task-response
 *
 * `devpad_tasks_upsert` (and every other task-returning tool) resolves to a
 * `TaskWithDetails` — `{ task, codebase_tasks, tags }` (see
 * `packages/schema/src/types.ts`) — not a flat task row. Mutation commands
 * that read `result.id` / `result.title` directly get `undefined` back.
 * This schema validates the boundary and gives callers a typed `.task` to
 * read from instead of dereferencing blind.
 */

export const task_mutation_response = z
	.object({
		// `rev` is optional here only for fixture back-compat in existing tests —
		// every real API response includes it; `devpad tasks done` (task A2.6)
		// needs it as the CompletionEngine's base_rev OCC guard.
		task: z.object({ id: z.string(), title: z.string(), rev: z.number().int().optional() }).passthrough(),
	})
	.passthrough();

export type TaskMutationResponse = z.infer<typeof task_mutation_response>;

export function parse_task_response(data: unknown): TaskMutationResponse {
	const parsed = task_mutation_response.safeParse(data);
	if (!parsed.success) {
		throw new Error(`Unexpected task response shape: ${parsed.error.message}`);
	}
	return parsed.data;
}
