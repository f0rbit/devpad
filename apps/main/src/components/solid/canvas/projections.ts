import type { ApiClient } from "@devpad/api";
import type { Task, TaskLink } from "@devpad/schema";

export type NodeProjection = {
	readonly waiting: boolean;
	readonly docsStatus: "draft" | "in_review" | "approved" | null;
	readonly pulseSpark: number[] | null;
};

/**
 * P3.2 — node/detail-LOD-only projections. All three sources are fetched
 * ONCE per call (never per-node — that would be an N+1 fan-out over
 * whatever's currently visible):
 *
 * - `waiting`: reuses the SAME `/reviews/pending` aggregate `WaitingOnYou`
 *   already renders elsewhere, filtered client-side by `subject_id`.
 * - `docsStatus`: reuses `docs.list({ project_id })` (already project-scoped,
 *   no `task_id` filter — one call covers every task) and keeps the most
 *   recent doc's status per task.
 * - `pulseSpark`: the project's own `by_day` pageview series (there's no
 *   per-task pulse metric yet) rendered only for tasks that carry an
 *   outgoing `tracks_metric` link — every such task shares the same
 *   project-level series today. A real per-task metric binding (the
 *   `tracks_metric` link's `ref` column is already shaped for it) is a
 *   follow-up, not a P3 backend addition.
 */
export async function fetch_node_projections(
	client: ApiClient,
	project_id: string,
	tasks: readonly Task[],
	links: readonly TaskLink[],
): Promise<Map<string, NodeProjection>> {
	const tracked_ids = new Set(links.filter((link) => link.kind === "tracks_metric").map((link) => link.src_id));

	const [pending_result, docs_result, pulse_result] = await Promise.all([
		client.reviews.pending(),
		client.docs.list({ project_id }),
		client.pulse.summary({ project_id, range: "7d" }),
	]);

	const waiting_ids = new Set(pending_result.ok ? pending_result.value.items.map((item) => item.subject_id) : []);

	const docs_status_by_task = new Map<string, "draft" | "in_review" | "approved">();
	if (docs_result.ok) {
		for (const doc of docs_result.value) {
			if (!doc.task_id) continue;
			docs_status_by_task.set(doc.task_id, doc.status);
		}
	}

	const spark = pulse_result.ok ? pulse_result.value.by_day.map((d) => d.pageviews) : [];

	const projections = new Map<string, NodeProjection>();
	for (const task of tasks) {
		projections.set(task.id, {
			waiting: waiting_ids.has(task.id),
			docsStatus: docs_status_by_task.get(task.id) ?? null,
			pulseSpark: tracked_ids.has(task.id) && spark.length > 0 ? spark : null,
		});
	}
	return projections;
}
