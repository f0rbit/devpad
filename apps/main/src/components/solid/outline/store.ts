import { rank_between } from "@devpad/schema";
import type { Task } from "@devpad/schema";
import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { track } from "@/lib/pulse";
import {
	buildOutlineNodes,
	childrenOf,
	hasChildren,
	indexById,
	type OutlineTreeNode,
	type RollupCounts,
	type TaskById,
} from "./types";
import * as api from "./mutations";

const WINDOW_SIZE = 100;
const RIPPLE_MS = 650;
const TOAST_MS = 4600;
const TOAST_EXIT_MS = 220;

export type ToastKind = "info" | "error" | "hook";
export type Toast = { id: string; message: string; kind: ToastKind; leaving: boolean };

export type OutlineStoreInput = {
	ownerId: string;
	projectId: string;
	zoomTask: Task | null;
	ancestors: Task[];
	nodes: Task[];
	rollups: Partial<Record<string, RollupCounts>>;
};

const collectIds = (nodes: OutlineTreeNode[]): string[] =>
	nodes.flatMap((n) => [n.id, ...(n.children ? collectIds(n.children) : [])]);

/** Walks the already-built (windowed + compacted) tree in display order — the exact order j/k navigates. */
function flattenVisible(nodes: OutlineTreeNode[], expanded: ReadonlySet<string>): string[] {
	const out: string[] = [];
	for (const node of nodes) {
		out.push(node.id);
		if (node.children && node.children.length > 0 && expanded.has(node.id)) {
			out.push(...flattenVisible(node.children, expanded));
		}
	}
	return out;
}

export function createOutlineStore(input: OutlineStoreInput) {
	const [tasks, setTasks] = createStore<TaskById>(indexById(input.nodes));
	const [rollups, setRollups] = createStore<Partial<Record<string, RollupCounts>>>({ ...input.rollups });

	/** A completion at `from_id` bumps every ancestor's cached fraction by exactly one — the known delta, not a recount. */
	const bumpRollupUpChain = (from_id: string) => {
		let cursor = tasks[from_id]?.parent_id ?? null;
		let first = true;
		while (cursor) {
			if (rollups[cursor]) {
				setRollups(
					cursor,
					produce((row: RollupCounts | undefined) => {
						if (!row) return;
						row.subtree_done = Math.min(row.subtree_total, row.subtree_done + 1);
						if (first) row.direct_done = Math.min(row.direct_total, row.direct_done + 1);
					}),
				);
			}
			first = false;
			cursor = tasks[cursor]?.parent_id ?? null;
		}
	};
	const [zoomTask, setZoomTask] = createSignal<Task | null>(input.zoomTask);
	const [ancestors, setAncestors] = createSignal<Task[]>(input.ancestors);

	const initialNodes = buildOutlineNodes(input.zoomTask?.id ?? null, tasks, new Set(), new Set(), WINDOW_SIZE);
	const [expanded, setExpanded] = createSignal<Set<string>>(new Set(collectIds(initialNodes)));
	const [compactOpen, setCompactOpen] = createSignal<Set<string>>(new Set());
	const [windowOpen, setWindowOpen] = createSignal<Set<string>>(new Set());
	const [selected, setSelected] = createSignal<string | null>(null);
	const [renamingId, setRenamingId] = createSignal<string | null>(null);
	const [rippling, setRippling] = createSignal<Set<string>>(new Set());
	const [toasts, setToasts] = createSignal<Toast[]>([]);
	const [pending, setPending] = createSignal<Set<string>>(new Set());

	const nodes = () => buildOutlineNodes(zoomTask()?.id ?? null, tasks, compactOpen(), windowOpen(), WINDOW_SIZE);
	const visibleIds = () => flattenVisible(nodes(), expanded());

	const toast = (message: string, kind: ToastKind = "info") => {
		const id = crypto.randomUUID();
		setToasts((prev) => [...prev, { id, message, kind, leaving: false }]);
		setTimeout(() => {
			setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
			setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_EXIT_MS);
		}, TOAST_MS);
	};

	const flash = (id: string) => {
		setRippling((prev) => new Set(prev).add(id));
		setTimeout(
			() =>
				setRippling((prev) => {
					const next = new Set(prev);
					next.delete(id);
					return next;
				}),
			RIPPLE_MS,
		);
	};

	const withPending = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
		setPending((prev) => new Set(prev).add(id));
		try {
			return await fn();
		} finally {
			setPending((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
		}
	};

	const toggleExpanded = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const expand = (id: string) => setExpanded((prev) => new Set(prev).add(id));
	const setExpandedAll = (ids: string[]) => setExpanded(new Set(ids));

	const select = (id: string | null) => setSelected(id);

	const selectDelta = (delta: 1 | -1) => {
		const ids = visibleIds();
		if (ids.length === 0) return;
		const current = selected();
		const idx = current ? ids.indexOf(current) : -1;
		const next_idx = idx === -1 ? 0 : Math.min(Math.max(idx + delta, 0), ids.length - 1);
		setSelected(ids[next_idx] ?? null);
	};

	const reopenCompacted = (id: string) => setCompactOpen((prev) => new Set(prev).add(id));
	const recompact = (id: string) =>
		setCompactOpen((prev) => {
			const next = new Set(prev);
			next.delete(id);
			return next;
		});
	const showMore = (windowKey: string) => setWindowOpen((prev) => new Set(prev).add(windowKey));

	/** space — advance a leaf's progress one step; no-op past COMPLETED or on a parent/approval-only node's ring bullet. */
	const advance = async (id: string) => {
		const task = tasks[id];
		if (!task || pending().has(id)) return;
		if (hasChildren(id, tasks)) return; // parent rows advance via zoom, not the status dot

		if (task.progress === "UNSTARTED") {
			await withPending(id, () => api.startTask(id, input.ownerId)).then((result) => {
				if (!result.ok) {
					toast(`Couldn't start "${task.title}": ${result.error.message}`, "error");
					return;
				}
				setTasks(id, "progress", "IN_PROGRESS");
			});
			return;
		}

		if (task.progress === "IN_PROGRESS") {
			const base_rev = task.rev;
			const result = await withPending(id, () => api.completeTask(id, base_rev));
			if (!result.ok) {
				if (result.error.status_code === 409) {
					const reload = await api.reloadTask(id);
					if (reload.ok && reload.value) setTasks(id, reload.value.task);
					toast(`"${task.title}" changed elsewhere — reloaded`, "error");
					return;
				}
				toast(`Couldn't complete "${task.title}": ${result.error.message}`, "error");
				return;
			}

			setTasks(id, result.value.completed);
			flash(id);
			bumpRollupUpChain(id);
			track("outline_task_completed", { project_id: input.projectId, task_id: id });

			result.value.bubbled.forEach((step, i) => {
				setTimeout(
					() => {
						setTasks(step.task.id, step.task);
						flash(step.task.id);
						bumpRollupUpChain(step.task.id);
					},
					240 * (i + 1),
				);
			});

			if (result.value.hooks_fired.length > 0) {
				toast(`⚡ ${result.value.hooks_fired.join(", ")} fired`, "hook");
			}
		}
	};

	const startRename = (id: string) => setRenamingId(id);
	const cancelRename = () => setRenamingId(null);

	const commitRename = async (id: string, title: string) => {
		setRenamingId(null);
		const trimmed = title.trim();
		if (!trimmed || trimmed === tasks[id]?.title) return;
		const result = await api.renameTask(id, trimmed, input.ownerId);
		if (!result.ok) {
			toast(`Rename failed: ${result.error.message}`, "error");
			return;
		}
		setTasks(id, result.value.task);
	};

	const addChild = async (parentId: string | null, title: string) => {
		const trimmed = title.trim();
		if (!trimmed) return;
		const lastSibling = childrenOf(parentId, tasks).at(-1);
		const rank = rank_between(lastSibling?.rank ?? null, null);
		const result = await api.createChild({
			title: trimmed,
			owner_id: input.ownerId,
			project_id: input.projectId,
			parent_id: parentId,
			rank,
		});
		if (!result.ok) {
			toast(`Couldn't add "${trimmed}": ${result.error.message}`, "error");
			return;
		}
		setTasks(result.value.task.id, result.value.task);
		if (parentId) expand(parentId);
		setSelected(result.value.task.id);
		track("outline_task_created", { project_id: input.projectId, task_id: result.value.task.id });
	};

	/** tab/shift-tab reparent: tab nests under the previous sibling, shift-tab promotes to the grandparent. */
	const reparent = async (id: string, direction: "in" | "out") => {
		const task = tasks[id];
		if (!task) return;
		const siblings = childrenOf(task.parent_id, tasks);
		const idx = siblings.findIndex((s) => s.id === id);

		let newParentId: string | null;
		if (direction === "in") {
			const prevSibling = idx > 0 ? siblings[idx - 1] : null;
			if (!prevSibling) return;
			newParentId = prevSibling.id;
		} else {
			if (task.parent_id == null) return;
			// The zoom root itself never lives in `tasks` (it's rendered as the
			// page header, not a row) — its own parent comes from `ancestors()`.
			newParentId =
				task.parent_id === zoomTask()?.id ? (ancestors()[0]?.id ?? null) : (tasks[task.parent_id]?.parent_id ?? null);
		}

		const result = await api.reparentTask(id, newParentId, task.rev);
		if (!result.ok) {
			if (result.error.status_code === 409) {
				const reload = await api.reloadTask(id);
				if (reload.ok && reload.value) setTasks(id, reload.value.task);
				toast(`"${task.title}" changed elsewhere — reloaded`, "error");
				return;
			}
			toast(`Couldn't reparent "${task.title}": ${result.error.message}`, "error");
			return;
		}
		setTasks(id, "parent_id", newParentId);
		setTasks(id, "rev", task.rev + 1);
		if (newParentId) expand(newParentId);
	};

	return {
		tasks,
		rollups,
		zoomTask,
		setZoomTask,
		ancestors,
		setAncestors,
		nodes,
		visibleIds,
		selected,
		select,
		selectDelta,
		expanded,
		toggleExpanded,
		expand,
		setExpandedAll,
		rippling,
		pending,
		toasts,
		toast,
		reopenCompacted,
		recompact,
		showMore,
		advance,
		renamingId,
		startRename,
		cancelRename,
		commitRename,
		addChild,
		reparent,
		/**
		 * Wholesale swap for a zoom navigation — a fresh `tree()`/`ancestors()` fetch
		 * replaces the visible view entirely. `selectAfter` re-selects the node the
		 * caller zoomed out FROM, so ⇧z / crumb navigation keeps context instead of
		 * landing with nothing highlighted; zoom-in / direct-URL loads pass `null`.
		 */
		resetView: (data: Omit<OutlineStoreInput, "ownerId" | "projectId">, selectAfter: string | null = null) => {
			setTasks(reconcile(indexById(data.nodes)));
			setRollups(reconcile({ ...data.rollups }));
			setZoomTask(data.zoomTask);
			setAncestors(data.ancestors);
			const fresh = buildOutlineNodes(
				data.zoomTask?.id ?? null,
				indexById(data.nodes),
				new Set(),
				new Set(),
				WINDOW_SIZE,
			);
			setExpandedAll(collectIds(fresh));
			setCompactOpen(new Set<string>());
			setWindowOpen(new Set<string>());
			setSelected(selectAfter);
		},
	};
}

export type OutlineStore = ReturnType<typeof createOutlineStore>;
