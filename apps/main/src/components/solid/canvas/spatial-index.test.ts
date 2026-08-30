import { describe, expect, test } from "bun:test";
import { build_synthetic_graph, SYNTHETIC_TASK_COUNT } from "./__fixtures__/synthetic-graph";
import { CANVAS_NODE_H, CANVAS_NODE_W, layout_graph } from "./layout";
import { build_spatial_index, type SpatialItem } from "./spatial-index";

describe("build_spatial_index", () => {
	test("query returns only items whose cell overlaps the rect", () => {
		const items: SpatialItem[] = [
			{ id: "near", x: 0, y: 0, w: 10, h: 10 },
			{ id: "far", x: 1000, y: 1000, w: 10, h: 10 },
		];
		const index = build_spatial_index(items, 100);

		expect(index.query({ x: -50, y: -50, w: 100, h: 100 })).toEqual(new Set(["near"]));
		expect(index.query({ x: 950, y: 950, w: 100, h: 100 })).toEqual(new Set(["far"]));
	});

	test("an item spanning multiple cells is found from any overlapping query cell", () => {
		const items: SpatialItem[] = [{ id: "wide", x: 0, y: 0, w: 250, h: 40 }];
		const index = build_spatial_index(items, 100);

		expect(index.query({ x: 220, y: 0, w: 10, h: 10 }).has("wide")).toBe(true);
		expect(index.query({ x: -10, y: 0, w: 10, h: 10 }).has("wide")).toBe(true);
	});

	test("empty index queries return an empty set", () => {
		const index = build_spatial_index([], 100);
		expect(index.query({ x: 0, y: 0, w: 100, h: 100 }).size).toBe(0);
	});
});

describe("build_spatial_index at map-level culling scale", () => {
	test("a small viewport over a ~500-node synthetic graph culls well under the total", () => {
		const graph = build_synthetic_graph();
		const layout = layout_graph(graph.tasks, graph.links);
		expect(layout.nodes.length).toBe(SYNTHETIC_TASK_COUNT);

		const cell_size = Math.max(CANVAS_NODE_W, CANVAS_NODE_H) * 2;
		const items: SpatialItem[] = layout.nodes.map((node) => ({
			id: node.task.id,
			x: node.x - CANVAS_NODE_W / 2,
			y: node.y - CANVAS_NODE_H / 2,
			w: CANVAS_NODE_W,
			h: CANVAS_NODE_H,
		}));
		const index = build_spatial_index(items, cell_size);

		// A viewport-sized rect (map-level scale) centered on the layout bounds —
		// far smaller than the full graph extent laid out by dagre.
		const viewport = { width: 1280, height: 800 };
		const map_scale = 0.58;
		const world_w = viewport.width / map_scale;
		const world_h = viewport.height / map_scale;
		const rect = {
			x: layout.bounds.x + layout.bounds.w / 2 - world_w / 2,
			y: layout.bounds.y + layout.bounds.h / 2 - world_h / 2,
			w: world_w,
			h: world_h,
		};

		const visible = index.query(rect);
		expect(visible.size).toBeGreaterThan(0);
		expect(visible.size).toBeLessThan(SYNTHETIC_TASK_COUNT / 2);
	});
});
