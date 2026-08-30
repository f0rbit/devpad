import dagre, { type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { Task, TaskLink } from "@devpad/schema";
import type { ContentBounds } from "./camera";

/**
 * Node footprint for the canvas surface — matches the `.node` card size in
 * the UX contract (`.plans/canvas-mock.html`: `.node { width: 250px;
 * min-height: 124px }`). Deliberately larger than the graph lens' compact
 * `NODE_W`/`NODE_H` (176x44) — the lens is an ephemeral overlay, the canvas
 * is the full surface.
 */
export const CANVAS_NODE_W = 250;
export const CANVAS_NODE_H = 124;

export type NodeSize = { readonly width: number; readonly height: number };

export type LaidOutNode = { readonly task: Task; readonly x: number; readonly y: number };
export type LaidOutEdge = {
	readonly id: string;
	readonly kind: TaskLink["kind"];
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
	kind: TaskLink["kind"];
	id: string;
	src_id: string;
	dst_id: string;
	points?: { x: number; y: number }[];
};

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
	const g = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>();
	g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 32, marginy: 32 });

	const id_set = new Set(tasks.map((task) => task.id));
	for (const task of tasks) g.setNode(task.id, { width: node_size.width, height: node_size.height });
	for (const link of links) {
		if (!link.dst_id || !id_set.has(link.src_id) || !id_set.has(link.dst_id)) continue; // edge culling — dangling/foreign links never reach the layout
		g.setEdge(link.src_id, link.dst_id, { kind: link.kind, id: link.id, src_id: link.src_id, dst_id: link.dst_id });
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
