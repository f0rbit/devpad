import { getBrowserClient } from "@devpad/core/ui/client";
import type { ApiResult, ApplyResponse, DoneResponse } from "@devpad/api";
import type { TaskWithDetails } from "@devpad/schema";

/** UNSTARTED → IN_PROGRESS is the plain (non-OCC) field write — no completion cascade involved. */
export function startTask(id: string, owner_id: string): Promise<ApiResult<TaskWithDetails>> {
	return getBrowserClient().tasks.upsert({ id, progress: "IN_PROGRESS", owner_id });
}

/** IN_PROGRESS → COMPLETED routes through the single completion entrypoint so the bubble chain comes back. */
export function completeTask(id: string, base_rev: number): Promise<ApiResult<DoneResponse>> {
	return getBrowserClient().tasks.done(id, { base_rev });
}

export function renameTask(id: string, title: string, owner_id: string): Promise<ApiResult<TaskWithDetails>> {
	return getBrowserClient().tasks.upsert({ id, title, owner_id });
}

/** Sibling reorder (alt-↑/↓) — a plain field write, same as rename; `rank` never affects graph structure so no reparent guard applies. */
export function reorderTask(id: string, rank: string, owner_id: string): Promise<ApiResult<TaskWithDetails>> {
	return getBrowserClient().tasks.upsert({ id, rank, owner_id });
}

export function createChild(input: {
	title: string;
	owner_id: string;
	project_id: string;
	parent_id: string | null;
	rank: string;
}): Promise<ApiResult<TaskWithDetails>> {
	return getBrowserClient().tasks.upsert(input);
}

/** Reparent via the batch-apply graph op; the server assigns a default rank ("i0") for the new sibling set. */
export function reparentTask(
	id: string,
	parent_id: string | null,
	base_rev: number,
): Promise<ApiResult<ApplyResponse>> {
	return getBrowserClient().tasks.apply({
		idempotency_key: `outline-reparent-${id}-${String(base_rev)}-${String(Date.now())}`,
		ops: [{ op: "reparent", id, parent_id, base_rev }],
	});
}

export function reloadTask(id: string): Promise<ApiResult<TaskWithDetails | null>> {
	return getBrowserClient().tasks.find(id);
}
