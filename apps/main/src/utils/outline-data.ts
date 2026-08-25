import type { ApiClient, EdgeSummary, RollupCounts } from "@devpad/api";
import type { Task } from "@devpad/schema";

/**
 * How far a single `tree()` call descends from its root — bounded well under
 * `GRAPH_DEPTH_CAP` (8) so the initial page load stays cheap; zooming into a
 * node just re-fetches from the new root, so depth is never actually a
 * ceiling on how far a user can travel (per the outline's "you never see
 * depth, you travel it" UX contract).
 */
export const OUTLINE_DEPTH = 6;

export type OutlineData = {
	/** null at the project root (no single task represents "the whole project"). */
	zoomTask: Task | null;
	/** Immediate-parent-first chain above `zoomTask`; empty at the project root. */
	ancestors: Task[];
	/** Flat pool of every visible node below the zoom point (or every root's subtree, unzoomed). */
	nodes: Task[];
	rollups: Partial<Record<string, RollupCounts>>;
	edgeSummary: Partial<Record<string, EdgeSummary>>;
};

/**
 * Zoomed view: one `tree()` call from the zoomed node, plus its ancestor
 * chain for breadcrumbs. Returns `null` if the node doesn't exist or belongs
 * to a different project (callers redirect back to the unzoomed page rather
 * than leak cross-project data through a mistyped `?node=`).
 */
async function load_zoomed(client: ApiClient, project_id: string, zoom_id: string): Promise<OutlineData | null> {
	const [tree_result, ancestors_result] = await Promise.all([
		client.tasks.tree(zoom_id, OUTLINE_DEPTH),
		client.tasks.ancestors(zoom_id),
	]);
	if (!tree_result.ok) return null;
	if (tree_result.value.task.project_id !== project_id) return null;

	return {
		zoomTask: tree_result.value.task,
		ancestors: ancestors_result.ok ? ancestors_result.value : [],
		nodes: tree_result.value.descendants,
		rollups: tree_result.value.rollups,
		edgeSummary: tree_result.value.edge_summary,
	};
}

/**
 * Project-root view: no single task stands for "the project", so the roots
 * are every `parent_id IS NULL` task, each fetched via its own bounded
 * `tree()` call (kept separate from the zoomed path so a huge project never
 * pulls its entire task list just to show the top level).
 */
async function load_root(client: ApiClient, project_id: string): Promise<OutlineData> {
	const list_result = await client.tasks.getByProject(project_id);
	const root_ids = list_result.ok
		? list_result.value.filter((t) => t.task.parent_id == null).map((t) => t.task.id)
		: [];

	if (root_ids.length === 0) return { zoomTask: null, ancestors: [], nodes: [], rollups: {}, edgeSummary: {} };

	const trees = await Promise.all(root_ids.map((id) => client.tasks.tree(id, OUTLINE_DEPTH)));
	const nodes: Task[] = [];
	const rollups: Partial<Record<string, RollupCounts>> = {};
	const edgeSummary: Partial<Record<string, EdgeSummary>> = {};
	for (const result of trees) {
		if (!result.ok) continue;
		nodes.push(result.value.task, ...result.value.descendants);
		Object.assign(rollups, result.value.rollups);
		Object.assign(edgeSummary, result.value.edge_summary);
	}
	return { zoomTask: null, ancestors: [], nodes, rollups, edgeSummary };
}

export function loadOutline(
	client: ApiClient,
	project_id: string,
	zoom_id: string | null,
): Promise<OutlineData | null> {
	return zoom_id ? load_zoomed(client, project_id, zoom_id) : load_root(client, project_id);
}
