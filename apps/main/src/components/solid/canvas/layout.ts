import dagre, { type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { Task, TaskLink } from "@devpad/schema";
import type { ContentBounds, ViewportSize } from "./camera";

export type NodeSize = { readonly width: number; readonly height: number };

/**
 * Fold kinds (goal/milestone) show a title at every LOD (even `map`) instead
 * of collapsing to a bare dot — purely a `canvas-node.tsx` content decision
 * now that the box itself (below) no longer varies by kind or LOD.
 */
export const FOLD_KINDS: ReadonlySet<Task["kind"]> = new Set(["milestone", "goal"]);

/**
 * ONE fixed world-space box for every node, regardless of kind or camera
 * LOD — Tom's staging feedback ("space things out better so when we zoom in
 * things are still spaced properly") traced to the box dagre reserved for
 * spacing (`CANVAS_NODE_W`/`H`, a single uniform size) disagreeing with the
 * box `canvas-node.tsx` actually RENDERED, which used to grow per LOD up to
 * 320x300 at `detail` — bigger than dagre had reserved, so a zoomed-in card
 * could grow past its allocated footprint and overlap a neighbour. There is
 * exactly one reserved/rendered box, always this size: LOD only swaps INNER
 * content (`canvas-node.tsx`) and the `map`-tier dot/pill treatment is a pure
 * CSS `transform: scale` DOWN into that same fixed box — it never changes the
 * box's actual width/height, so it can never grow past what dagre reserved
 * for it.
 *
 * **Sized to `node`-tier content, not a round number** — Tom's staging
 * feedback ("the boxes should be smaller"): the previous 260x200 box left
 * ~60% empty chrome below the title/meta/chip-row content, which actually
 * needs roughly 240x104 (head: title + meta line + 31px ring, padding
 * 15/8px ≈54px; body: border + one chip row + padding ≈54px). `detail`'s
 * extra content (description/sparkline) no longer grows this box at all — it
 * renders as a separate `.canvas-node-detail-overlay`, absolutely positioned
 * in the world layer OUTSIDE this box (see `canvas-node.tsx`), so it may
 * overlap a neighbour without needing dagre to reserve space for it. Node/
 * detail content (title + kind/status meta + one chip row) is structurally
 * IDENTICAL for fold (`milestone`/`goal`) and non-fold kinds at this LOD —
 * fold kinds only differ at `map` (dot vs. pill, a pure CSS transform, never
 * a box-size change) — so a single uniform box for every kind is correct,
 * not a simplification. `node_size_for` keeps a `kind` parameter anyway (a
 * future kind-specific size has exactly one call site to change) but every
 * kind currently maps to the same box.
 */
export const CANVAS_NODE_W = 240;
export const CANVAS_NODE_H = 108;

export function node_size_for(_kind: Task["kind"]): NodeSize {
	return { width: CANVAS_NODE_W, height: CANVAS_NODE_H };
}

/**
 * `hierarchy` is a structural edge derived from `parent_id` — never a row in
 * `task_link` — so it isn't part of `TASK_LINK_KINDS`. It's added purely so
 * dagre's LR ranking follows the goal -> milestone -> task -> subtask tree
 * instead of treating every node as a disconnected island; the surface
 * renders it as a thin/muted line with no arrowhead (containment, not a
 * directional relationship).
 */
export type EdgeKind = TaskLink["kind"] | "hierarchy";

/**
 * dagre's own rank direction. Chosen per-graph by `layout_graph` (see below)
 * rather than hardcoded — a graph that's naturally deep-and-narrow (many
 * ranks, few siblings) fits a landscape viewport well as `LR`; a graph
 * that's shallow-and-wide (few ranks, many siblings — e.g. one milestone
 * with ~20 direct children) fits better as `TB`, ranks stacking vertically
 * instead of one rank ballooning tall. dagre still owns BOTH the node
 * positions AND the edge routing for whichever direction is picked — never
 * reflowed after the fact (see the reverted `wrap_dense_ranks`: moving nodes
 * post-layout without re-routing edges produced a hairball, PR #152 review).
 */
export type LayoutOrientation = "LR" | "TB";

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
	readonly rankdir: LayoutOrientation;
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
export const EMPTY_LAYOUT: GraphLayout = { nodes: [], edges: [], bounds: EMPTY_BOUNDS, rankdir: "LR" };

/** Above this many tasks, running dagre TWICE (once per candidate `rankdir`) just to compare fit scores isn't worth the extra layout pass — falls back to the fixed `LR` default matching pre-orientation behaviour. */
const ORIENTATION_COMPARE_TASK_CAP = 500;

/**
 * Single dagre pass for one `rankdir` candidate — factored out of
 * `layout_graph` so orientation selection (below) can run it twice (once per
 * candidate direction) without duplicating the graph-building logic.
 */
function run_dagre(
	tasks: readonly Task[],
	links: readonly TaskLink[],
	node_size: NodeSize,
	rankdir: LayoutOrientation,
): { readonly nodes: LaidOutNode[]; readonly edges: LaidOutEdge[] } {
	// `multigraph: true` — a hierarchy edge and a task_link edge can share the
	// same (parent, child) pair, and dagre's default single-edge graph would
	// silently overwrite one with the other. `acyclicer: "greedy"` is a
	// defensive no-op for the hierarchy edges specifically (a cycle is
	// impossible via `parent_id` — guarded elsewhere) but keeps dagre robust
	// if a future edge source ever introduces one.
	const g = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
	// Spacing per Tom's staging feedback ("space things out better") — at
	// least 0.6x the card's width between siblings and a full card width
	// between ranks, so the fixed `node_size_for` box (see above) always has
	// visible breathing room around it, not just enough to avoid touching.
	// Scaled with `CANVAS_NODE_W` (the smaller content-sized box) rather than
	// hardcoded, so a future box resize doesn't silently drift below either
	// minimum.
	g.setGraph({
		rankdir,
		nodesep: Math.round(node_size.width * 0.65),
		ranksep: Math.round(node_size.width * 1.15),
		marginx: 32,
		marginy: 32,
		acyclicer: "greedy",
	});

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
	return { nodes, edges };
}

/** How much of `viewport` a `bounds`-sized forest would occupy at its best uniform-scale fit — purely a COMPARISON metric between `LR`/`TB` candidates, not the camera's actual fit computation (`camera.ts` owns that, with its own margin/inset/cap rules). Larger is better; `0` for a degenerate (zero-area) bounds always loses. */
function fit_scale_for(bounds: ContentBounds, viewport: ViewportSize): number {
	if (bounds.w <= 0 || bounds.h <= 0) return 0;
	return Math.min(viewport.width / bounds.w, viewport.height / bounds.h);
}

/**
 * Layered (dagre) layout — NEVER force-directed, per the canvas UX contract:
 * a graph you can predict beats one that resettles every render. Extracted
 * from `lenses/graph-lens.tsx`'s `layoutGraph` (kept identical rank/parent
 * layout logic; the lens keeps its own smaller-node-footprint copy since it
 * returns a lens-local `{width, height}` shape rather than camera-ready
 * `ContentBounds` — not a clean swap without touching the lens' render path).
 *
 * `viewport`, when given, picks `rankdir` by comparing each candidate's
 * `fit_scale_for` against it (ties -> `LR`) — a deliberate deviation from the
 * UX mock's fixed `LR` (see AGENTS.md's Canvas section). Omitted (or a
 * degenerate 0x0), or above `ORIENTATION_COMPARE_TASK_CAP` tasks, always
 * yields `LR` (the pre-orientation default) without paying for a second
 * dagre pass. dagre owns positions AND edge routing for whichever direction
 * wins — nothing reflows either afterward.
 */
export function layout_graph(
	tasks: readonly Task[],
	links: readonly TaskLink[],
	node_size: NodeSize = { width: CANVAS_NODE_W, height: CANVAS_NODE_H },
	viewport?: ViewportSize,
): GraphLayout {
	if (tasks.length === 0) return EMPTY_LAYOUT;

	const lr = run_dagre(tasks, links, node_size, "LR");
	const lr_layout: GraphLayout = {
		nodes: lr.nodes,
		edges: lr.edges,
		bounds: bounds_for(lr.nodes, node_size),
		rankdir: "LR",
	};

	if (!viewport || viewport.width <= 0 || viewport.height <= 0 || tasks.length > ORIENTATION_COMPARE_TASK_CAP) {
		return lr_layout;
	}

	const tb = run_dagre(tasks, links, node_size, "TB");
	const tb_layout: GraphLayout = {
		nodes: tb.nodes,
		edges: tb.edges,
		bounds: bounds_for(tb.nodes, node_size),
		rankdir: "TB",
	};

	return fit_scale_for(tb_layout.bounds, viewport) > fit_scale_for(lr_layout.bounds, viewport) ? tb_layout : lr_layout;
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
 * P3.3 — applies view-state pins (drag overrides, last-write-wins). For any
 * UNPINNED agent-created task (`created_by === "api"`) with a parent
 * elsewhere in the same layout, `programmaticIds` still marks it (drives the
 * `.canvas-node-programmatic` chip + one-time placement cue) — but its
 * POSITION is only overridden with the deterministic "beside its parent"
 * offset when dagre never actually ranked it against that parent (no
 * `hierarchy` edge connects them — layout_graph's job since the
 * "hierarchy edges" pass, see layout.ts's top-of-file comment). Every
 * `parent_id` present in the same task set now feeds dagre a hierarchy edge,
 * so this fallback is dormant in the common case; it exists only for the
 * defensive case of a structurally-disconnected agent-created node. dagre
 * stays the layout — this function must never REPLACE a rank dagre already
 * computed, only fill in for a node it couldn't rank at all.
 *
 * **Stale-elbow fix**: any node whose FINAL position differs from dagre's
 * own (pinned, or agent-placed off-rank) drops dagre's routed `points` for
 * every edge touching it — dagre routed those bends against the position it
 * originally computed, so once the node moves, only re-anchoring the first/
 * last point (`clip_edge_endpoints`) leaves an interior bend hanging in the
 * node's OLD location, a visible elbow in empty space (Tom's staging
 * screenshot: a dragged/pinned node's `tracks_metric` edge). The replacement
 * is a plain 2-point [src, dst] pair — `canvas-surface.tsx`'s `path_for`
 * (`curveBumpX`/`Y`) then draws a clean curve between the two current
 * centers, and the existing per-render `clip_edge_endpoints` call still
 * anchors both ends to the actual box border. Edges untouched by a moved
 * node keep dagre's original multi-point route unchanged.
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
	const hierarchy_connected = new Set(
		layout.edges.filter((edge) => edge.kind === "hierarchy").map((edge) => `${edge.src_id}:${edge.dst_id}`),
	);
	const programmaticIds = new Set<string>();
	const sibling_count = new Map<string, number>();

	const nodes: LaidOutNode[] = layout.nodes.map((node) => {
		const pin = pins[node.task.id];
		if (pin) return { ...node, x: pin.x, y: pin.y };

		const parent_id = node.task.parent_id;
		const parent_pos = parent_id ? resolved.get(parent_id) : undefined;
		if (node.task.created_by !== "api" || !parent_pos || !parent_id) return node;

		programmaticIds.add(node.task.id);
		if (hierarchy_connected.has(`${parent_id}:${node.task.id}`)) return node; // dagre already ranked it — leave its position alone

		const index = sibling_count.get(parent_id) ?? 0;
		sibling_count.set(parent_id, index + 1);
		return {
			...node,
			x: parent_pos.x + AGENT_PLACEMENT_OFFSET.dx,
			y: parent_pos.y + AGENT_PLACEMENT_OFFSET.dy + index * (node_size.height + 16),
		};
	});

	const moved_ids = new Set(
		nodes
			.filter((node, i) => node.x !== layout.nodes[i]?.x || node.y !== layout.nodes[i]?.y)
			.map((node) => node.task.id),
	);
	const by_id = new Map(nodes.map((node) => [node.task.id, node]));
	const edges: LaidOutEdge[] = layout.edges.map((edge) => {
		if (!moved_ids.has(edge.src_id) && !moved_ids.has(edge.dst_id)) return edge;
		const src = by_id.get(edge.src_id);
		const dst = by_id.get(edge.dst_id);
		if (!src || !dst) return edge;
		return { ...edge, points: direct_route(src, dst) };
	});

	return { nodes, edges, bounds: bounds_for(nodes, node_size), rankdir: layout.rankdir, programmaticIds };
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
 * A raw, unclipped 2-point [src, dst] "route" — the direct-curve replacement
 * for a moved node's stale dagre `points` (see `apply_view_overrides`'s doc
 * comment above, and `canvas-surface.tsx`'s live-drag use of this same
 * helper). `clip_edge_endpoints` still re-anchors both ends to the actual
 * box border downstream; `path_for`'s `curveBumpX`/`Y` turns the 2 points
 * into a smooth curve rather than a straight line.
 */
export function direct_route(src: Point, dst: Point): Point[] {
	return [
		{ x: src.x, y: src.y },
		{ x: dst.x, y: dst.y },
	];
}

/**
 * dagre's `points` are routed for spacing purposes against the node's
 * reserved box position at LAYOUT time — a moved node (see
 * `apply_view_overrides`/`direct_route` above) already gets a fresh 2-point
 * route before this runs. For an UNMOVED edge, this just re-anchors the
 * first/last point to where the line actually crosses the box (via
 * `node_size_for`), leaving any interior dagre bend points untouched, so
 * arrowheads land exactly on the visible border without a relayout.
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
