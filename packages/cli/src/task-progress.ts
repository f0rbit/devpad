import type { ApiClient } from "@devpad/api";

/**
 * @module @devpad/cli/task-progress
 *
 * Single source of truth for the CLI's user-facing status strings
 * (`todo`/`in_progress`/`done`) → the `progress` enum the live API and
 * `upsert_todo` schema (`packages/schema/src/validation.ts`) actually
 * accept: `UNSTARTED | IN_PROGRESS | COMPLETED`.
 *
 * Also resolves `owner_id`, which `upsert_todo` requires on every
 * create/update — the worker rejects any value that doesn't exactly
 * match the authenticated caller (`packages/worker/src/routes/v1/tasks.ts`).
 */

export type TaskProgress = "UNSTARTED" | "IN_PROGRESS" | "COMPLETED";

const STATUS_TO_PROGRESS: Record<string, TaskProgress> = {
	todo: "UNSTARTED",
	in_progress: "IN_PROGRESS",
	done: "COMPLETED",
};

export const task_status_to_progress = (status?: string): TaskProgress | undefined =>
	status ? STATUS_TO_PROGRESS[status] : undefined;

export async function resolve_owner_id(client: ApiClient): Promise<string> {
	const result = await client.user.me();
	if (!result.ok) throw new Error(`Failed to resolve current user: ${result.error.message}`);
	return result.value.id;
}
