import dagre, { type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { Task, TaskLink } from "@devpad/schema";
import type { CameraLevel } from "./camera";
import type { ContentBounds } from "./camera";

export type NodeSize = { readonly width: number; readonly height: number };

/**
 * Fold kinds (goal/milestone) get a bigger `map`-tier footprint (dot + label,
 * not just a dot) — shared with `canvas-node.tsx` so layout spacing and the
 * node's own inline size never drift apart (this was the root cause of the
 * "goal node drawn over a task card" overlap: the label used to float BELOW
 * the box via absolute positioning, escaping whatever space dagre reserved).
 */
export const FOLD_KINDS: ReadonlySet<Task["kind"]> = new Set(["milestone", "goal"]);

/**
 * The exact box a `CanvasNode` renders at each LOD tier — single source of
 * truth consumed by BOTH `node_size_for` (below, used for the node's inline
 * `width`/`height` style) and CSS' cosmetic-only per-`data-lod` rules (which
 * must no longer set width/height themselves). Content taller than the
 * allocated height is capped via `overflow-y: auto` on the scrollable inner
 * region (`.canvas-node-body`), never by growing the box — a card growing
 * past its allocated footprint (e.g. from a long chip row wrapping to a 3rd
 * line) was the other root cause of node/node overlap.
 */
const NODE_SIZE_BY_LEVEL: Record<CameraLevel, NodeSize> = {
	map: { width: 20, height: 20 },
	neighborhood: { width: 250, height: 76 },
	node: { width: 260, height: 180 },
	detail: { width: 320, height: 300 },
};

const FOLD_MAP_SIZE: NodeSize = { width: 96, height: 44 };

export function node_size_for(kind: Task["kind"], level: CameraLevel): NodeSize {
	if (level === "map" && FOLD_KINDS.has(kind)) return FOLD_MAP_SIZE;
	return NODE_SIZE_BY_LEVEL[level];
}

/**
 * Node footprint dagre reserves when spacing ranks/siblings — the LARGEST
 * box any (kind, LOD) combination above can render, so a node can NEVER
 * visually collide with a neighbor regardless of which LOD tier is current.
 * This is deliberately NOT the per-LOD render size: relaying out on every
 * LOD-tier change (so spacing shrinks/grows to match the current tier) would
 * jump non-pinned node positions on every zoom transition, fighting the
 * "predictable, stable graph" premise dagre layout exists for. Trading some
 * extra whitespace at `map`/`neighborhood` for positions that never move on
 * zoom is the simpler, less surprising fix.
 */
export const CANVAS_NODE_W = 320;
export const CANVAS_NODE_H = 300;

/**
 * `hierarchy` is a structural edge derived from `parent_id` — never a row in
 * `task_link` — so it isn't part of `TASK_LINK_KINDS`. It's added purely so
 * dagre's LR ranking follows the goal -> milestone -> task -> subtask tree
 * instead of treating every node as a disconnected island; the surface
 * renders it as a thin/muted line with no arrowhead (containment, not a
 * directional relationship).
 */
export type EdgeKind = TaskLink["kind"] | "hierarchy";

export type LaidOutNode = { readonly task: Task; readonly x: number; readonly y: number };
export type LaidOutEdge = {
	readonly id: string;
	readonly kind: EdgeKind;
	readonly points: readonly { x: number; y: number }[];
	readonly src_id: string;
	readonly dst_id: string;
};
export type GraphLayout = {
	readonly nodes: readonly LaidOutNode[];
	readonly edges: readonly LaidOutEdge[];
	readonly bounds: ContentBounds;
};

type EdgeLabel = {
	kind: EdgeKind;
	id: string;
	src_id: string;
	dst_id: string;
	points?: { x: number; y: number }[];
};

const hierarchy_edge_id = (parent_id: string, child_id: string): string => `hierarchy:${parent_id}:${child_id}`;

const EMPTY_BOUNDS: ContentBounds = { x: 0, y: 0, w: 0, h: 0 };
export const EMPTY_LAYOUT: GraphLayout = { nodes: [], edges: [], bounds: EMPTY_BOUNDS };

/**
 * Layered (dagre) layout — NEVER force-directed, per the canvas UX contract:
 * a graph you can predict beats one that resettles every render. Extracted
 * from `lenses/graph-lens.tsx`'s `layoutGraph` (kept identical rank/parent
 * layout logic; the lens keeps its own smaller-node-footprint copy since it
 * returns a lens-local `{width, height}` shape rather than camera-ready
 * `ContentBounds` — not a clean swap without touching the lens' render path).
 */
export function layout_graph(
	tasks: readonly Task[],
	links: readonly TaskLink[],
	node_size: NodeSize = { width: CANVAS_NODE_W, height: CANVAS_NODE_H },
): GraphLayout {
	// `multigraph: true` — a hierarchy edge and a task_link edge can share the
	// same (parent, child) pair, and dagre's default single-edge graph would
	// silently overwrite one with the other. `acyclicer: "greedy"` is a
	// defensive no-op for the hierarchy edges specifically (a cycle is
	// impossible via `parent_id` — guarded elsewhere) but keeps dagre robust
	// if a future edge source ever introduces one.
	const g = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
	g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 32, marginy: 32, acyclicer: "greedy" });

	const id_set = new Set(tasks.map((task) => task.id));
	for (const task of tasks) g.setNode(task.id, { width: node_size.width, height: node_size.height });

	// Hierarchy edges (parent -> child) first, so dagre's rank assignment
	// follows the goal/milestone/task tree — without these, tasks with no
	// `task_link` are disconnected islands dagre ranks arbitrarily.
	for (const task of tasks) {
		if (!task.parent_id || !id_set.has(task.parent_id)) continue;
		const id = hierarchy_edge_id(task.parent_id, task.id);
		g.setEdge(task.parent_id, task.id, { kind: "hierarchy", id, src_id: task.parent_id, dst_id: task.id }, id);
	}
	for (const link of links) {
		if (!link.dst_id || !id_set.has(link.src_id) || !id_set.has(link.dst_id)) continue; // edge culling — dangling/foreign links never reach the layout
		g.setEdge(
			link.src_id,
			link.dst_id,
			{ kind: link.kind, id: link.id, src_id: link.src_id, dst_id: link.dst_id },
			link.id,
		);
	}
	dagre.layout(g);

	const nodes: LaidOutNode[] = tasks.map((task) => {
		const pos = g.node(task.id);
		return { task, x: pos.x ?? 0, y: pos.y ?? 0 };
	});
	const edges: LaidOutEdge[] = g.edges().map((e) => {
		const label = g.edge(e);
		return { id: label.id, kind: label.kind, points: label.points ?? [], src_id: label.src_id, dst_id: label.dst_id };
	});

	if (nodes.length === 0) return EMPTY_LAYOUT;
	return { nodes, edges, bounds: bounds_for(nodes, node_size) };
}

function bounds_for(nodes: readonly LaidOutNode[], node_size: NodeSize): ContentBounds {
	const half_w = node_size.width / 2;
	const half_h = node_size.height / 2;
	const xs = nodes.map((node) => node.x);
	const ys = nodes.map((node) => node.y);
	const min_x = Math.min(...xs) - half_w;
	const max_x = Math.max(...xs) + half_w;
	const min_y = Math.min(...ys) - half_h;
	const max_y = Math.max(...ys) + half_h;
	return { x: min_x, y: min_y, w: max_x - min_x, h: max_y - min_y };
}

export type ViewPin = { readonly x: number; readonly y: number };

/** Fixed offset (dagre's own nodesep/ranksep-scaled) an un-pinned agent-created node is placed at, relative to its parent — matches the UX contract's "placed beside its parent so it is never lost in the map". */
const AGENT_PLACEMENT_OFFSET = { dx: CANVAS_NODE_W * 0.7, dy: CANVAS_NODE_H * 0.9 };

/**
 * P3.3 — applies view-state pins (drag overrides, last-write-wins) and, for
 * any UNPINNED agent-created task (`created_by === "api"`) with a parent
 * elsewhere in the same layout, a deterministic "beside its parent"
 * placement instead of wherever dagre put it — so an agent-created node
 * never gets lost in a busy map. Returns which node ids got the
 * agent-placement treatment (`programmaticIds`) so the caller can show the
 * one-time visual cue.
 */
export function apply_view_overrides(
	layout: GraphLayout,
	node_size: NodeSize = { width: CANVAS_NODE_W, height: CANVAS_NODE_H },
	pins: Readonly<Partial<Record<string, ViewPin>>> = {},
): GraphLayout & { readonly programmaticIds: ReadonlySet<string> } {
	if (layout.nodes.length === 0) return { ...layout, programmaticIds: new Set() };

	// Resolve pinned positions first — agent-placement reads off the PARENT's
	// resolved (pin-aware) position, not its raw dagre position, so pinning a
	// parent drags its unpinned agent-created children along with it.
	const resolved = new Map(
		layout.nodes.map((node) => {
			const pin = pins[node.task.id];
			return [node.task.id, pin ? { x: pin.x, y: pin.y } : { x: node.x, y: node.y }] as const;
		}),
	);
	const programmaticIds = new Set<string>();
	const sibling_count = new Map<string, number>();

	const nodes: LaidOutNode[] = layout.nodes.map((node) => {
		const pin = pins[node.task.id];
		if (pin) return { ...node, x: pin.x, y: pin.y };

		const parent_id = node.task.parent_id;
		const parent_pos = parent_id ? resolved.get(parent_id) : undefined;
		if (node.task.created_by === "api" && parent_pos) {
			const index = sibling_count.get(parent_id ?? "") ?? 0;
			sibling_count.set(parent_id ?? "", index + 1);
			programmaticIds.add(node.task.id);
			return {
				...node,
				x: parent_pos.x + AGENT_PLACEMENT_OFFSET.dx,
				y: parent_pos.y + AGENT_PLACEMENT_OFFSET.dy + index * (node_size.height + 16),
			};
		}
		return node;
	});

	return { nodes, edges: layout.edges, bounds: bounds_for(nodes, node_size), programmaticIds };
}

type Point = { readonly x: number; readonly y: number };

/**
 * Where a ray from `center` toward `toward` crosses the border of the
 * axis-aligned box `{center, half_w, half_h}` — the standard "clip a line to
 * a rect" formula (scale by whichever axis hits its half-extent first).
 */
function clip_to_box(center: Point, half_w: number, half_h: number, toward: Point): Point {
	const dx = toward.x - center.x;
	const dy = toward.y - center.y;
	if (dx === 0 && dy === 0) return center;
	const scale = Math.min(
		dx !== 0 ? half_w / Math.abs(dx) : Number.POSITIVE_INFINITY,
		dy !== 0 ? half_h / Math.abs(dy) : Number.POSITIVE_INFINITY,
	);
	return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * dagre's `points` are routed for spacing purposes against the uniform
 * `CANVAS_NODE_W`/`CANVAS_NODE_H` reservation, NOT the node's actual current
 * (per-LOD, per-kind) rendered box — so the raw points land short of, or
 * buried inside, the real card. Re-anchors just the first/last point to
 * where the line actually crosses the REAL box (via `node_size_for`),
 * leaving any interior dagre bend points untouched, so arrowheads land
 * exactly on the visible border at every LOD tier without a relayout.
 */
export function clip_edge_endpoints(
	points: readonly Point[],
	src: { readonly x: number; readonly y: number; readonly size: NodeSize },
	dst: { readonly x: number; readonly y: number; readonly size: NodeSize },
): Point[] {
	const first = points.at(0);
	const last = points.at(-1);
	if (!first || !last) return [];
	const toward_first = points.at(1) ?? dst;
	const toward_last = points.length > 1 ? (points.at(-2) ?? src) : src;
	const clipped_first = clip_to_box({ x: src.x, y: src.y }, src.size.width / 2, src.size.height / 2, toward_first);
	const clipped_last = clip_to_box({ x: dst.x, y: dst.y }, dst.size.width / 2, dst.size.height / 2, toward_last);
	return [clipped_first, ...points.slice(1, -1), clipped_last];
}
