import type { Task, TaskLink } from "@devpad/schema";
import { describe, expect, test } from "bun:test";
import { apply_view_overrides, CANVAS_NODE_H, CANVAS_NODE_W, EMPTY_LAYOUT, layout_graph } from "./layout";

const make_task = (id: string, overrides: Partial<Task> = {}): Task =>
	({
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
		...overrides,
	}) as Task;

const make_link = (src_id: string, dst_id: string | null, kind: TaskLink["kind"] = "blocks"): TaskLink =>
	({
		id: `${src_id}->${String(dst_id)}`,
		src_id,
		dst_id,
		kind,
		ref: null,
		note: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
	}) as TaskLink;

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

	test("an unpinned agent-created task is placed beside its resolved parent position", () => {
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent", created_by: "api" })];
		const layout = layout_graph(tasks, []);

		const overridden = apply_view_overrides(layout);

		const parent = overridden.nodes.find((n) => n.task.id === "parent");
		const child = overridden.nodes.find((n) => n.task.id === "child");
		expect(overridden.programmaticIds.has("child")).toBe(true);
		expect(child?.x).toBeGreaterThan(parent?.x ?? 0);
	});

	test("pinning the parent drags an unpinned agent-created child along with it", () => {
		const tasks = [make_task("parent"), make_task("child", { parent_id: "parent", created_by: "api" })];
		const layout = layout_graph(tasks, []);

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
