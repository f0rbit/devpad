import type { EdgeSummary, RollupCounts } from "@devpad/api";
import type { Task } from "@devpad/schema";
import type { TreeNode } from "@f0rbit/ui";

/** Row payload the Tree component's `renderNode` receives — one per visible task. */
export type OutlineRowData = {
	task: Task;
	/** True once this subtree qualifies for compaction (self + every child done) and isn't pinned open. */
	compacted: boolean;
	/** Direct-child count folded into a compacted row's summary label. */
	compactedCount: number;
};

/** A synthetic "N done · compacted" row swapped in for a fully-done subtree's real children. */
export type OutlineCompactSummary = { compactSummaryFor: string; count: number };

/** A synthetic "show N more" row standing in for a sibling set beyond the window. */
export type OutlineMoreSummary = { moreFor: string; remaining: number };

type OutlineNodeData = OutlineRowData | OutlineCompactSummary | OutlineMoreSummary;

export type OutlineTreeNode = TreeNode<OutlineNodeData>;

/** A stale/synthetic id (a compacted or windowed-out row, a task removed elsewhere) is a real, expected miss — never a plain `Record`. */
export type TaskById = Partial<Record<string, Task>>;

export const isCompactSummary = (data: OutlineNodeData | undefined): data is OutlineCompactSummary =>
	data != null && "compactSummaryFor" in data;

export const isMoreSummary = (data: OutlineNodeData | undefined): data is OutlineMoreSummary =>
	data != null && "moreFor" in data;

const definedTasks = (tasksById: TaskById): Task[] => Object.values(tasksById).filter((t): t is Task => t != null);

export const hasChildren = (id: string, tasksById: TaskById): boolean =>
	definedTasks(tasksById).some((t) => t.parent_id === id);

export const childrenOf = (id: string | null, tasksById: TaskById): Task[] =>
	definedTasks(tasksById)
		.filter((t) => t.parent_id === id)
		.toSorted((a, b) => (a.rank === b.rank ? a.id.localeCompare(b.id) : a.rank.localeCompare(b.rank)));

/** A subtree auto-compacts once the node itself and every direct child are COMPLETED. */
const subtreeFullyDone = (task: Task, tasksById: TaskById): boolean => {
	if (task.progress !== "COMPLETED") return false;
	const children = childrenOf(task.id, tasksById);
	return children.length > 0 && children.every((c) => c.progress === "COMPLETED");
};

/**
 * Builds the `@f0rbit/ui` Tree's node array for one level, recursively.
 * `compactOpen` holds ids a user explicitly re-expanded past their default
 * compaction — everything else compacts automatically per
 * `subtreeFullyDone`. `windowSize` caps how many siblings render before a
 * "show more" affordance takes over (the outline's simple stand-in for
 * virtualization — see B1.2's "windowed rendering" note).
 */
export function buildOutlineNodes(
	parentId: string | null,
	tasksById: TaskById,
	compactOpen: ReadonlySet<string>,
	windowOpen: ReadonlySet<string>,
	windowSize: number,
): OutlineTreeNode[] {
	const windowKey = parentId ?? "$root";
	const siblings = childrenOf(parentId, tasksById);
	const truncated = !windowOpen.has(windowKey) && siblings.length > windowSize;
	const visible = truncated ? siblings.slice(0, windowSize) : siblings;

	const nodes: OutlineTreeNode[] = visible.map((task): OutlineTreeNode => {
		const children = childrenOf(task.id, tasksById);
		const compacted = subtreeFullyDone(task, tasksById) && !compactOpen.has(task.id);

		return {
			id: task.id,
			label: task.title,
			data: { task, compacted, compactedCount: children.length },
			children: compacted
				? [
						{
							id: `${task.id}__compact`,
							label: "compacted",
							data: { compactSummaryFor: task.id, count: children.length },
						},
					]
				: buildOutlineNodes(task.id, tasksById, compactOpen, windowOpen, windowSize),
		};
	});

	if (truncated) {
		nodes.push({
			id: `${windowKey}__more`,
			label: "more",
			data: { moreFor: windowKey, remaining: siblings.length - windowSize },
		});
	}

	return nodes;
}

export const indexById = (tasks: Task[]): TaskById => Object.fromEntries(tasks.map((t) => [t.id, t]));

export type { EdgeSummary, RollupCounts };
