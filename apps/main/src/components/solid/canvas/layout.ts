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
export type LaidOutEdge = { readonly id: string; readonly kind: TaskLink["kind"]; readonly points: readonly { x: number; y: number }[] };
export type GraphLayout = { readonly nodes: readonly LaidOutNode[]; readonly edges: readonly LaidOutEdge[]; readonly bounds: ContentBounds };

type EdgeLabel = { kind: TaskLink["kind"]; id: string; points?: { x: number; y: number }[] };

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
export function layout_graph(tasks: readonly Task[], links: readonly TaskLink[], node_size: NodeSize = { width: CANVAS_NODE_W, height: CANVAS_NODE_H }): GraphLayout {
	const g = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>();
	g.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 96, marginx: 32, marginy: 32 });

	const id_set = new Set(tasks.map(task => task.id));
	for (const task of tasks) g.setNode(task.id, { width: node_size.width, height: node_size.height });
	for (const link of links) {
		if (!link.dst_id || !id_set.has(link.src_id) || !id_set.has(link.dst_id)) continue; // edge culling — dangling/foreign links never reach the layout
		g.setEdge(link.src_id, link.dst_id, { kind: link.kind, id: link.id });
	}
	dagre.layout(g);

	const nodes: LaidOutNode[] = tasks.map(task => {
		const pos = g.node(task.id);
		return { task, x: pos.x ?? 0, y: pos.y ?? 0 };
	});
	const edges: LaidOutEdge[] = g.edges().map(e => {
		const label = g.edge(e);
		return { id: label.id, kind: label.kind, points: label.points ?? [] };
	});

	if (nodes.length === 0) return EMPTY_LAYOUT;
	const half_w = node_size.width / 2;
	const half_h = node_size.height / 2;
	const xs = nodes.map(node => node.x);
	const ys = nodes.map(node => node.y);
	const min_x = Math.min(...xs) - half_w;
	const max_x = Math.max(...xs) + half_w;
	const min_y = Math.min(...ys) - half_h;
	const max_y = Math.max(...ys) + half_h;
	return { nodes, edges, bounds: { x: min_x, y: min_y, w: max_x - min_x, h: max_y - min_y } };
}
