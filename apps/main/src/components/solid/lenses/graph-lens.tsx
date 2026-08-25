import dagre, { type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import { getBrowserClient } from "@devpad/core/ui/client";
import type { RollupCounts } from "@devpad/api";
import { TASK_LINK_KINDS, type Task, type TaskLink } from "@devpad/schema";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { LensShell } from "./lens-shell";

export type GraphLensProps = {
	focusId: string;
	onClose: () => void;
	/** Double-click on a node — zooms the outline there and closes the lens. */
	onZoom: (id: string) => void;
};

const NODE_W = 176;
const NODE_H = 44;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const DEPTHS = [1, 2, 3] as const;
type LensDepth = (typeof DEPTHS)[number];

type GraphData = { tasks: Task[]; links: TaskLink[]; rollups: Partial<Record<string, RollupCounts>> };

type LensEdgeLabel = {
	kind: TaskLink["kind"];
	id: string;
	width?: number;
	height?: number;
	points?: { x: number; y: number }[];
};

type LaidOutNode = { task: Task; x: number; y: number };
type LaidOutEdge = { id: string; kind: TaskLink["kind"]; points: { x: number; y: number }[] };
type Layout = { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number };

const EMPTY_LAYOUT: Layout = { nodes: [], edges: [], width: 0, height: 0 };

/**
 * Layered (dagre) layout — NEVER force-directed, per the lens' UX contract:
 * a graph you can predict beats one that resettles every render.
 */
function layoutGraph(tasks: Task[], links: TaskLink[]): Layout {
	const g = new dagre.graphlib.Graph<GraphLabel, NodeLabel, LensEdgeLabel>();
	g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 72, marginx: 24, marginy: 24 });

	const id_set = new Set(tasks.map((t) => t.id));
	for (const task of tasks) g.setNode(task.id, { width: NODE_W, height: NODE_H });
	for (const link of links) {
		if (!link.dst_id || !id_set.has(link.src_id) || !id_set.has(link.dst_id)) continue; // edge culling — this is a lens, not a map
		g.setEdge(link.src_id, link.dst_id, { kind: link.kind, id: link.id });
	}
	dagre.layout(g);

	const nodes: LaidOutNode[] = tasks.map((task) => {
		const pos = g.node(task.id);
		return { task, x: pos.x ?? 0, y: pos.y ?? 0 };
	});
	const edges: LaidOutEdge[] = g.edges().map((e) => {
		const label = g.edge(e);
		return { id: label.id, kind: label.kind, points: label.points ?? [] };
	});
	const graph_label = g.graph();
	return { nodes, edges, width: graph_label.width ?? 0, height: graph_label.height ?? 0 };
}

const STATUS_CLASS: Record<Task["progress"], string> = {
	UNSTARTED: "lens-node-unstarted",
	IN_PROGRESS: "lens-node-doing",
	COMPLETED: "lens-node-done",
};

const EDGE_CLASS: Record<TaskLink["kind"], string> = {
	blocks: "lens-edge-blocks",
	relates_to: "lens-edge-relates",
	discovered_from: "lens-edge-discovered",
	references: "lens-edge-references",
	tracks_metric: "lens-edge-metric",
};

/** Every edge kind gets its own arrowhead marker so color-blind users still
 * get the kind from marker shape/fill, matching `EDGE_CLASS`'s stroke. */
const arrowIdFor = (kind: TaskLink["kind"]): string => `lens-arrow-${kind.replace(/_/g, "-")}`;

const EDGE_LABEL: Record<TaskLink["kind"], string> = {
	blocks: "blocks",
	relates_to: "relates to",
	discovered_from: "discovered from",
	references: "references",
	tracks_metric: "tracks metric",
};

const pathFor = (points: { x: number; y: number }[]): string =>
	points.map((p, i) => `${i === 0 ? "M" : "L"}${String(p.x)},${String(p.y)}`).join(" ");

/**
 * Task B2.1 — the graph lens: an ephemeral, Esc-dismissable overlay over the
 * task-link neighborhood (`tasks.near`), NOT the outline tree. Depth-2
 * default with a 1/2/3 toggle; click refocuses the lens on that node
 * in-place, double-click zooms the OUTLINE there and closes the lens.
 */
export default function GraphLens(props: GraphLensProps) {
	const [focusId, setFocusId] = createSignal(props.focusId);
	const [depth, setDepth] = createSignal<LensDepth>(2);
	const [data, setData] = createSignal<GraphData | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [transform, setTransform] = createSignal({ x: 0, y: 0, scale: 1 });
	let viewportRef: HTMLDivElement | undefined;

	const layout = (): Layout => {
		const d = data();
		return d ? layoutGraph(d.tasks, d.links) : EMPTY_LAYOUT;
	};

	const fit = () => {
		const l = layout();
		const viewport = viewportRef;
		if (!viewport || l.width === 0) {
			setTransform({ x: 0, y: 0, scale: 1 });
			return;
		}
		const rect = viewport.getBoundingClientRect();
		const scale = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, Math.min(rect.width / (l.width + 80), rect.height / (l.height + 80), 1)),
		);
		setTransform({ x: (rect.width - l.width * scale) / 2, y: (rect.height - l.height * scale) / 2, scale });
	};

	createEffect(() => {
		const id = focusId();
		const d = depth();
		setLoading(true);
		void getBrowserClient()
			.tasks.near(id, d)
			.then((result) => {
				if (result.ok) {
					setData({ tasks: result.value.tasks, links: result.value.links, rollups: result.value.rollups });
					fit();
				}
			})
			.finally(() => setLoading(false));
	});

	let dragging = false;
	let lastPoint = { x: 0, y: 0 };
	const onPointerDown = (e: PointerEvent) => {
		// A pointerdown that landed on a node is a click/dblclick candidate, not
		// a pan gesture — capturing the pointer here would retarget the
		// eventual pointerup (and suppress the synthesized click) onto the
		// viewport instead of the node underneath it.
		if ((e.target as Element).closest(".lens-node")) return;
		dragging = true;
		lastPoint = { x: e.clientX, y: e.clientY };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: PointerEvent) => {
		if (!dragging) return;
		const dx = e.clientX - lastPoint.x;
		const dy = e.clientY - lastPoint.y;
		lastPoint = { x: e.clientX, y: e.clientY };
		setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
	};
	const onPointerUp = () => {
		dragging = false;
	};
	// Cursor-anchored zoom — the point under the pointer stays fixed on screen
	// (compensate x/y for the scale change) rather than pivoting at the
	// viewport's layout origin, which used to shove the graph sideways on
	// every scroll tick.
	const onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const rect = viewportRef?.getBoundingClientRect();
		if (!rect) return;
		const px = e.clientX - rect.left;
		const py = e.clientY - rect.top;
		const delta = -e.deltaY * 0.0012;
		setTransform((t) => {
			const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale + delta));
			const worldX = (px - t.x) / t.scale;
			const worldY = (py - t.y) / t.scale;
			return { x: px - worldX * nextScale, y: py - worldY * nextScale, scale: nextScale };
		});
	};

	const onKey = (e: KeyboardEvent) => {
		if (e.key === "1" || e.key === "2" || e.key === "3") setDepth(Number(e.key) as LensDepth);
		if (e.key === "f" || e.key === "0") fit();
	};

	// A single onClick handler with a deferred-action timer, not
	// onClick+onDblClick: `setFocusId` triggers a re-layout (node positions
	// shift), which would move the target out from under the SECOND physical
	// click of a native double-click gesture before it lands. Deferring the
	// single-click refocus until the double-click window has passed keeps
	// every node's position stable for the whole click/dblclick gesture.
	const DOUBLE_CLICK_MS = 300;
	let pendingId: string | null = null;
	let pendingTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		clearTimeout(pendingTimer);
	});

	const onNodeClick = (id: string) => {
		if (pendingId === id && pendingTimer) {
			clearTimeout(pendingTimer);
			pendingTimer = undefined;
			pendingId = null;
			props.onZoom(id);
			props.onClose();
			return;
		}
		pendingId = id;
		pendingTimer = setTimeout(() => {
			setFocusId(id);
			pendingTimer = undefined;
			pendingId = null;
		}, DOUBLE_CLICK_MS);
	};

	return (
		<LensShell
			title="Graph lens"
			onClose={props.onClose}
			onKey={onKey}
			headerExtra={
				<div class="lens-depth-toggle" role="group" aria-label="Neighborhood depth">
					<For each={DEPTHS}>
						{(d) => (
							<button
								type="button"
								class={`lens-depth-btn${depth() === d ? " lens-depth-btn-active" : ""}`}
								onClick={() => setDepth(d)}
							>
								{d}
							</button>
						)}
					</For>
					<button type="button" class="lens-fit-btn" onClick={fit}>
						fit
					</button>
				</div>
			}
		>
			<div
				ref={viewportRef}
				class={`lens-graph-viewport${loading() && data() ? " lens-graph-viewport-revalidating" : ""}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerLeave={onPointerUp}
				onWheel={onWheel}
			>
				{/* A depth toggle or refocus re-fetches — keep the STALE graph on
				screen while it revalidates instead of blanking to a loading
				state; only the very first load (no data yet) shows the fallback. */}
				<Show when={data() !== null} fallback={<p class="lens-graph-status">Loading neighborhood…</p>}>
					<Show when={layout().nodes.length > 0} fallback={<p class="lens-graph-status">No connections yet.</p>}>
						<svg class="lens-graph-svg" width="100%" height="100%">
							<defs>
								<For each={TASK_LINK_KINDS}>
									{(kind) => (
										<marker
											id={arrowIdFor(kind)}
											viewBox="0 0 10 10"
											refX="9"
											refY="5"
											markerWidth="7"
											markerHeight="7"
											orient="auto-start-reverse"
										>
											<path d="M0,0 L10,5 L0,10 z" class={`lens-arrowhead ${EDGE_CLASS[kind]}-arrowhead`} />
										</marker>
									)}
								</For>
							</defs>
							<g
								transform={`translate(${String(transform().x)}, ${String(transform().y)}) scale(${String(transform().scale)})`}
							>
								<For each={layout().edges}>
									{(edge) => (
										<path
											d={pathFor(edge.points)}
											class={`lens-edge ${EDGE_CLASS[edge.kind]}`}
											marker-end={`url(#${arrowIdFor(edge.kind)})`}
										/>
									)}
								</For>
								<For each={layout().nodes}>
									{(node) => {
										const rollup = () => data()?.rollups[node.task.id];
										return (
											<g
												class={`lens-node ${STATUS_CLASS[node.task.progress]}${node.task.id === focusId() ? " lens-node-focus" : ""}`}
												data-testid="lens-graph-node"
												data-task-id={node.task.id}
												transform={`translate(${String(node.x - NODE_W / 2)}, ${String(node.y - NODE_H / 2)})`}
												onClick={() => {
													onNodeClick(node.task.id);
												}}
											>
												<rect width={NODE_W} height={NODE_H} rx={8} class="lens-node-rect" />
												<text x={10} y={18} class="lens-node-title">
													{node.task.title.length > 24 ? `${node.task.title.slice(0, 24)}…` : node.task.title}
												</text>
												<text x={10} y={34} class="lens-node-meta">
													{node.task.kind}
													<Show when={(rollup()?.subtree_total ?? 0) > 0}>
														{" "}
														· {rollup()?.subtree_done}/{rollup()?.subtree_total}
													</Show>
												</text>
											</g>
										);
									}}
								</For>
							</g>
						</svg>
						<div class="lens-legend" data-testid="lens-legend">
							<For each={TASK_LINK_KINDS}>
								{(kind) => (
									<span class="lens-legend-item">
										<span class={`lens-legend-sw ${EDGE_CLASS[kind]}-sw`} />
										{EDGE_LABEL[kind]}
									</span>
								)}
							</For>
						</div>
					</Show>
				</Show>
			</div>
			<div class="lens-hintbar">
				<span>
					<b>1/2/3</b> depth
				</span>
				<span>
					<b>click</b> refocus
				</span>
				<span>
					<b>dblclick</b> zoom outline
				</span>
				<span>
					<b>drag</b> pan · <b>wheel</b> zoom
				</span>
				<span>
					<b>esc</b> close
				</span>
			</div>
		</LensShell>
	);
}
