import type { Task, TaskLink } from "@devpad/schema";
import { describe, expect, test } from "bun:test";
import staging_graph from "../../../../../../tests/e2e/fixtures/staging-devpad-graph.json" with { type: "json" };
import {
	apply_view_overrides,
	CANVAS_NODE_H,
	CANVAS_NODE_W,
	clip_edge_endpoints,
	EMPTY_LAYOUT,
	layout_graph,
	node_size_for,
} from "./layout";

const make_task = (id: string, overrides: Partial<Task> = {}): Task => {
	const task: Task = {
		id,
		title: id,
		kind: "task",
		progress: "UNSTARTED",
		visibility: "PRIVATE",
		priority: "LOW",
		completion_policy: "manual",
		project_id: "project-1",
		owner_id: "owner-1",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		goal_id: null,
		description: null,
		start_time: null,
		end_time: null,
		summary: null,
		codebase_task_id: null,
		parent_id: null,
		rank: "",
		rev: 0,
		completed_via: null,
		claimed_by: null,
		claimed_at: null,
		stage: null,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
		...overrides,
	};
	return task;
};

const make_link = (src_id: string, dst_id: string | null, kind: TaskLink["kind"] = "blocks"): TaskLink => {
	const link: TaskLink = {
		id: `${src_id}->${String(dst_id)}`,
		src_id,
		dst_id,
		kind,
		ref: null,
		note: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	};
	return link;
};

describe("layout_graph", () => {
	test("empty input returns EMPTY_LAYOUT", () => {
		expect(layout_graph([], [])).toBe(EMPTY_LAYOUT);
	});

	test("positions every task and keeps every valid edge", () => {
		const tasks = [make_task("a"), make_task("b"), make_task("c")];
		const links = [make_link("a", "b"), make_link("b", "c", "relates_to")];

		const layout = layout_graph(tasks, links);

		expect(layout.nodes).toHaveLength(3);
		expect(layout.edges).toHaveLength(2);
		expect(new Set(layout.nodes.map((n) => n.task.id))).toEqual(new Set(["a", "b", "c"]));
	});

	test("culls edges pointing at dangling/foreign task ids", () => {
		const tasks = [make_task("a"), make_task("b")];
		const links = [make_link("a", "b"), make_link("a", "missing"), make_link("a", null)];

		const layout = layout_graph(tasks, links);

		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0]?.id).toBe(links[0]?.id);
	});

	test("is deterministic for the same input (never force-directed jitter)", () => {
		const tasks = [make_task("a"), make_task("b"), make_task("c"), make_task("d")];
		const links = [make_link("a", "b"), make_link("b", "c"), make_link("a", "d")];

		const first = layout_graph(tasks, links);
		const second = layout_graph(tasks, links);

		expect(first.nodes.map((n) => ({ id: n.task.id, x: n.x, y: n.y }))).toEqual(
			second.nodes.map((n) => ({ id: n.task.id, x: n.x, y: n.y })),
		);
	});

	test("adds a hierarchy edge for every in-project parent_id, ranking children after their parent", () => {
		const tasks = [
			make_task("goal"),
			make_task("milestone", { parent_id: "goal" }),
			make_task("task", { parent_id: "milestone" }),
		];

		const layout = layout_graph(tasks, []);

		const hierarchy_edges = layout.edges.filter((e) => e.kind === "hierarchy");
		expect(hierarchy_edges).toHaveLength(2);
		expect(hierarchy_edges.some((e) => e.src_id === "goal" && e.dst_id === "milestone")).toBe(true);
		expect(hierarchy_edges.some((e) => e.src_id === "milestone" && e.dst_id === "task")).toBe(true);

		const by_id = new Map(layout.nodes.map((n) => [n.task.id, n]));
		const goal_x = by_id.get("goal")?.x ?? 0;
		const milestone_x = by_id.get("milestone")?.x ?? 0;
		const task_x = by_id.get("task")?.x ?? 0;
		expect(milestone_x).toBeGreaterThan(goal_x);
		expect(task_x).toBeGreaterThan(milestone_x);
	});

	test("hierarchy edges never replace an overlapping task_link edge between the same pair", () => {
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent" })];
		const links = [make_link("parent", "child", "blocks")];

		const layout = layout_graph(tasks, links);

		expect(layout.edges).toHaveLength(2);
		expect(layout.edges.some((e) => e.kind === "hierarchy")).toBe(true);
		expect(layout.edges.some((e) => e.kind === "blocks")).toBe(true);
	});

	test("a parent_id pointing outside the loaded task set is never added as a hierarchy edge", () => {
		const tasks = [make_task("child", { parent_id: "outside-the-project" })];

		const layout = layout_graph(tasks, []);

		expect(layout.edges).toHaveLength(0);
	});

	test("bounds fully contain every node's card footprint", () => {
		const tasks = [make_task("a"), make_task("b"), make_task("c")];
		const links = [make_link("a", "b"), make_link("b", "c")];

		const { nodes, bounds } = layout_graph(tasks, links);

		for (const node of nodes) {
			expect(node.x - CANVAS_NODE_W / 2).toBeGreaterThanOrEqual(bounds.x);
			expect(node.x + CANVAS_NODE_W / 2).toBeLessThanOrEqual(bounds.x + bounds.w);
			expect(node.y - CANVAS_NODE_H / 2).toBeGreaterThanOrEqual(bounds.y);
			expect(node.y + CANVAS_NODE_H / 2).toBeLessThanOrEqual(bounds.y + bounds.h);
		}
	});
});

describe("apply_view_overrides", () => {
	test("a pinned task takes its pin position, not dagre's", () => {
		const tasks = [make_task("a"), make_task("b")];
		const layout = layout_graph(tasks, [make_link("a", "b")]);

		const overridden = apply_view_overrides(layout, undefined, { b: { x: 999, y: 888 } });

		const b = overridden.nodes.find((n) => n.task.id === "b");
		expect(b?.x).toBe(999);
		expect(b?.y).toBe(888);
		expect(overridden.programmaticIds.has("b")).toBe(false);
	});

	test("an agent-created task dagre already ranked via a hierarchy edge is marked programmatic but keeps dagre's position — dagre stays the layout", () => {
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent", created_by: "api" })];
		const layout = layout_graph(tasks, []);
		const raw_child = layout.nodes.find((n) => n.task.id === "child");

		const overridden = apply_view_overrides(layout);

		const child = overridden.nodes.find((n) => n.task.id === "child");
		expect(overridden.programmaticIds.has("child")).toBe(true);
		expect(child?.x).toBe(raw_child?.x);
		expect(child?.y).toBe(raw_child?.y);
	});

	test("an agent-created node with NO hierarchy edge to its resolved parent (structurally disconnected) falls back to beside-parent placement", () => {
		// Built directly rather than via layout_graph — this exercises the
		// defensive fallback for a node dagre never actually ranked against its
		// parent (no `hierarchy` edge in the layout), which layout_graph no
		// longer produces for any parent_id present in the same task set.
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent", created_by: "api" })];
		const layout = {
			nodes: [
				{ task: tasks[0], x: 0, y: 0 },
				{ task: tasks[1], x: 0, y: 0 },
			],
			edges: [],
			bounds: { x: 0, y: 0, w: 0, h: 0 },
			rankdir: "LR" as const,
		};

		const overridden = apply_view_overrides(layout);

		const parent = overridden.nodes.find((n) => n.task.id === "parent");
		const child = overridden.nodes.find((n) => n.task.id === "child");
		expect(overridden.programmaticIds.has("child")).toBe(true);
		expect(child?.x).toBeGreaterThan(parent?.x ?? 0);
	});

	test("pinning the parent drags an unpinned, structurally-disconnected agent-created child along with it", () => {
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent", created_by: "api" })];
		const layout = {
			nodes: [
				{ task: tasks[0], x: 0, y: 0 },
				{ task: tasks[1], x: 0, y: 0 },
			],
			edges: [],
			bounds: { x: 0, y: 0, w: 0, h: 0 },
			rankdir: "LR" as const,
		};

		const overridden = apply_view_overrides(layout, undefined, { parent: { x: 500, y: 500 } });

		const child = overridden.nodes.find((n) => n.task.id === "child");
		expect(child?.x).toBeGreaterThan(500);
		expect(child?.y).toBeGreaterThan(500);
	});

	test("a user-created task with no pin keeps its dagre position", () => {
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent", created_by: "user" })];
		const layout = layout_graph(tasks, []);

		const overridden = apply_view_overrides(layout);

		expect(overridden.programmaticIds.size).toBe(0);
	});
});

/**
 * Regression coverage for the "map view collapses into a narrow vertical
 * strip, edges run through cards" bug: `apply_view_overrides`' agent-
 * placement fallback used to unconditionally reposition every
 * `created_by: "api"` task beside its parent, discarding dagre's own LR rank
 * for the 47/55 staging tasks that are agent-created — collapsing the whole
 * forest's horizontal spread into a handful of x columns while `layout.ts`'s
 * edges (routed for the ORIGINAL dagre positions) kept pointing at where
 * nodes used to be. This suite runs the real `layout_graph` +
 * `apply_view_overrides` pipeline against the exact fixture from Tom's
 * staging review.
 */
describe("layout_graph + apply_view_overrides on the staging fixture", () => {
	const tasks = staging_graph.tasks as unknown as Task[];
	const links = staging_graph.links as unknown as TaskLink[];
	const layout = apply_view_overrides(layout_graph(tasks, links));

	test("every edge's endpoints land within its src/dst node's rect, not off in stale dagre-routed space", () => {
		const by_id = new Map(layout.nodes.map((n) => [n.task.id, n]));
		for (const edge of layout.edges) {
			const src = by_id.get(edge.src_id);
			const dst = by_id.get(edge.dst_id);
			expect(src).toBeDefined();
			expect(dst).toBeDefined();
			if (!src || !dst) continue;

			const src_size = node_size_for(src.task.kind, "neighborhood");
			const dst_size = node_size_for(dst.task.kind, "neighborhood");
			const [first, ...rest] = clip_edge_endpoints(
				edge.points,
				{ x: src.x, y: src.y, size: src_size },
				{ x: dst.x, y: dst.y, size: dst_size },
			);
			const last = rest.at(-1) ?? first;

			expect(first.x).toBeGreaterThanOrEqual(src.x - src_size.width / 2 - 0.5);
			expect(first.x).toBeLessThanOrEqual(src.x + src_size.width / 2 + 0.5);
			expect(first.y).toBeGreaterThanOrEqual(src.y - src_size.height / 2 - 0.5);
			expect(first.y).toBeLessThanOrEqual(src.y + src_size.height / 2 + 0.5);

			expect(last.x).toBeGreaterThanOrEqual(dst.x - dst_size.width / 2 - 0.5);
			expect(last.x).toBeLessThanOrEqual(dst.x + dst_size.width / 2 + 0.5);
			expect(last.y).toBeGreaterThanOrEqual(dst.y - dst_size.height / 2 - 0.5);
			expect(last.y).toBeLessThanOrEqual(dst.y + dst_size.height / 2 + 0.5);
		}
	});

	test("no two node rects (dagre's own reserved footprint) intersect", () => {
		const half_w = CANVAS_NODE_W / 2;
		const half_h = CANVAS_NODE_H / 2;
		const rects = layout.nodes.map((n) => ({
			x0: n.x - half_w,
			x1: n.x + half_w,
			y0: n.y - half_h,
			y1: n.y + half_h,
		}));
		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				const a = rects[i];
				const b = rects[j];
				const overlaps = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
				expect(overlaps).toBe(false);
			}
		}
	});

	test("the forest spreads across at least 3 distinct rank columns — not collapsed into a single narrow strip", () => {
		const distinct_x = new Set(layout.nodes.map((n) => Math.round(n.x / 10)));
		expect(distinct_x.size).toBeGreaterThanOrEqual(3);
	});
});

/**
 * Regression coverage for the "auto-orientation reflow produces a hairball"
 * bug (PR #152 review, coordinator-caught): the FIRST fix attempt
 * (`wrap_dense_ranks`) moved node positions AFTER dagre had already routed
 * edges against the original positions — exactly the class of bug #151 had
 * just fixed. The replacement (`layout_graph`'s `viewport` param picking
 * `LR`/`TB`) never reflows anything post-hoc: dagre runs ONCE per candidate
 * direction and owns both positions and edge routing for whichever wins, so
 * the SAME geometry invariants from the block above must hold for BOTH
 * orientations — this exercises them against the real staging fixture at
 * two viewports chosen to each pick a different `rankdir` (see the module
 * doc comment on `layout_graph`).
 */
describe.each([
	{ label: "LR (1000x680 — the default toolbar-sized viewport)", viewport: { width: 1000, height: 680 }, want: "LR" },
	{
		label: "TB (1600x500 — wide/short, favours stacking ranks vertically)",
		viewport: { width: 1600, height: 500 },
		want: "TB",
	},
] as const)("layout_graph orientation-by-aspect on the staging fixture — $label", ({ viewport, want }) => {
	const tasks = staging_graph.tasks as unknown as Task[];
	const links = staging_graph.links as unknown as TaskLink[];
	const layout = apply_view_overrides(layout_graph(tasks, links, undefined, viewport));

	test(`picks rankdir "${want}" for this viewport`, () => {
		expect(layout.rankdir).toBe(want);
	});

	test("every edge's endpoints land within its src/dst node's rect", () => {
		const by_id = new Map(layout.nodes.map((n) => [n.task.id, n]));
		for (const edge of layout.edges) {
			const src = by_id.get(edge.src_id);
			const dst = by_id.get(edge.dst_id);
			expect(src).toBeDefined();
			expect(dst).toBeDefined();
			if (!src || !dst) continue;

			const src_size = node_size_for(src.task.kind, "neighborhood");
			const dst_size = node_size_for(dst.task.kind, "neighborhood");
			const [first, ...rest] = clip_edge_endpoints(
				edge.points,
				{ x: src.x, y: src.y, size: src_size },
				{ x: dst.x, y: dst.y, size: dst_size },
			);
			const last = rest.at(-1) ?? first;

			expect(first.x).toBeGreaterThanOrEqual(src.x - src_size.width / 2 - 0.5);
			expect(first.x).toBeLessThanOrEqual(src.x + src_size.width / 2 + 0.5);
			expect(first.y).toBeGreaterThanOrEqual(src.y - src_size.height / 2 - 0.5);
			expect(first.y).toBeLessThanOrEqual(src.y + src_size.height / 2 + 0.5);

			expect(last.x).toBeGreaterThanOrEqual(dst.x - dst_size.width / 2 - 0.5);
			expect(last.x).toBeLessThanOrEqual(dst.x + dst_size.width / 2 + 0.5);
			expect(last.y).toBeGreaterThanOrEqual(dst.y - dst_size.height / 2 - 0.5);
			expect(last.y).toBeLessThanOrEqual(dst.y + dst_size.height / 2 + 0.5);
		}
	});

	test("no two node rects intersect", () => {
		const half_w = CANVAS_NODE_W / 2;
		const half_h = CANVAS_NODE_H / 2;
		const rects = layout.nodes.map((n) => ({
			x0: n.x - half_w,
			x1: n.x + half_w,
			y0: n.y - half_h,
			y1: n.y + half_h,
		}));
		for (let i = 0; i < rects.length; i++) {
			for (let j = i + 1; j < rects.length; j++) {
				const a = rects[i];
				const b = rects[j];
				const overlaps = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
				expect(overlaps).toBe(false);
			}
		}
	});

	/**
	 * Letterboxing on the non-binding axis is ACCEPTED (coordinator directive
	 * following the `wrap_dense_ranks` revert) — a graph with one very dense
	 * rank can't fill both viewport axes without either distorting the fit or
	 * reflowing positions post-layout (the very bug this replaces). Only the
	 * BINDING dimension (whichever axis the uniform-scale fit actually
	 * saturates — the larger of the two fill fractions below) needs to clear
	 * 80%; the other axis is allowed slack.
	 */
	test("the fit-to-forest scale fills at least 80% of the viewport's binding dimension", () => {
		const fit_margin = 40;
		const fit_top_inset_px = 64; // matches canvas-surface.tsx's CANVAS_TOOLBAR_INSET_PX
		const usable_w = viewport.width - fit_margin * 2;
		const usable_h = viewport.height - fit_margin * 2 - fit_top_inset_px;
		const scale = Math.min(usable_w / layout.bounds.w, usable_h / layout.bounds.h);
		const width_fill = (layout.bounds.w * scale) / usable_w;
		const height_fill = (layout.bounds.h * scale) / usable_h;

		expect(Math.max(width_fill, height_fill)).toBeGreaterThanOrEqual(0.8);
	});
});
