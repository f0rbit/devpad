import { describe, expect, test } from "bun:test";
import { create_camera, LEVEL_SCALE, type WheelInput } from "./camera";

const wheel = (partial: Partial<WheelInput>): WheelInput => ({
	offsetX: 0,
	offsetY: 0,
	deltaY: 0,
	ctrlKey: false,
	...partial,
});

describe("camera cursor-anchor invariance", () => {
	test("world point under the cursor is unchanged after a wheel zoom", () => {
		const camera = create_camera({ wheel_settle_ms: 100_000 }); // never settles mid-assertion
		camera.set_viewport({ width: 800, height: 600 });

		const anchor = { offsetX: 300, offsetY: 200 };
		const before = camera.transform();
		const world_before = {
			x: (anchor.offsetX - before.x) / before.scale,
			y: (anchor.offsetY - before.y) / before.scale,
		};

		camera.on_wheel(wheel({ ...anchor, deltaY: -120 }));

		const after = camera.transform();
		const world_after = { x: (anchor.offsetX - after.x) / after.scale, y: (anchor.offsetY - after.y) / after.scale };

		expect(world_after.x).toBeCloseTo(world_before.x, 6);
		expect(world_after.y).toBeCloseTo(world_before.y, 6);
		expect(after.scale).toBeGreaterThan(before.scale);

		camera.dispose();
	});

	test("ctrl+wheel (pinch) also preserves the anchored world point", () => {
		const camera = create_camera({ wheel_settle_ms: 100_000, initial_transform: { x: 0, y: 0, scale: 0.9 } });
		camera.set_viewport({ width: 800, height: 600 });

		const anchor = { offsetX: 120, offsetY: 90 };
		const before = camera.transform();
		const world_before = {
			x: (anchor.offsetX - before.x) / before.scale,
			y: (anchor.offsetY - before.y) / before.scale,
		};

		camera.on_wheel(wheel({ ...anchor, deltaY: 80, ctrlKey: true }));

		const after = camera.transform();
		const world_after = { x: (anchor.offsetX - after.x) / after.scale, y: (anchor.offsetY - after.y) / after.scale };

		expect(world_after.x).toBeCloseTo(world_before.x, 6);
		expect(world_after.y).toBeCloseTo(world_before.y, 6);
		expect(after.scale).toBeLessThan(before.scale);

		camera.dispose();
	});
});

describe("stepped zoom snap-to-level", () => {
	test("wheel settles the free-scroll scale onto the nearest named level", () => {
		const camera = create_camera({ wheel_settle_ms: 0, animation_ms: 0 });
		camera.set_viewport({ width: 800, height: 600 });

		camera.on_wheel(wheel({ offsetX: 400, offsetY: 300, deltaY: -150 }));

		expect(camera.level()).toBe("neighborhood");
		expect(camera.transform().scale).toBeCloseTo(LEVEL_SCALE.neighborhood, 6);

		camera.dispose();
	});

	test("zoom_to animates instantly to the exact level scale when animation_ms is 0", () => {
		const camera = create_camera({ animation_ms: 0 });
		camera.zoom_to("detail");
		expect(camera.level()).toBe("detail");
		expect(camera.transform().scale).toBe(LEVEL_SCALE.detail);
		camera.dispose();
	});

	test("zoom_in/zoom_out step one named level at a time and clamp at the ends", () => {
		const camera = create_camera({ animation_ms: 0 });
		expect(camera.level()).toBe("map");

		camera.zoom_out();
		expect(camera.level()).toBe("map"); // already at the bottom, clamps

		camera.zoom_in();
		expect(camera.level()).toBe("neighborhood");
		camera.zoom_in();
		camera.zoom_in();
		expect(camera.level()).toBe("detail");
		camera.zoom_in();
		expect(camera.level()).toBe("detail"); // already at the top, clamps

		camera.dispose();
	});
});

describe("content-bounds clamp", () => {
	test("panning far past the content never pushes it fully out of view", () => {
		const camera = create_camera({ animation_ms: 0 });
		camera.set_viewport({ width: 800, height: 600 });
		camera.set_content_bounds({ x: 0, y: 0, w: 400, h: 300 });

		camera.on_pointer_down({ clientX: 0, clientY: 0 });
		camera.on_pointer_move({ clientX: -100_000, clientY: -100_000 });
		camera.on_pointer_up();

		const t = camera.transform();
		const right_edge = t.x + 400 * t.scale;
		const bottom_edge = t.y + 300 * t.scale;
		expect(right_edge).toBeGreaterThan(0);
		expect(bottom_edge).toBeGreaterThan(0);

		camera.dispose();
	});

	test("panning far the other way keeps the left/top edge from vanishing off-screen", () => {
		const camera = create_camera({ animation_ms: 0 });
		camera.set_viewport({ width: 800, height: 600 });
		camera.set_content_bounds({ x: 0, y: 0, w: 400, h: 300 });

		camera.on_pointer_down({ clientX: 0, clientY: 0 });
		camera.on_pointer_move({ clientX: 100_000, clientY: 100_000 });
		camera.on_pointer_up();

		const t = camera.transform();
		expect(t.x).toBeLessThan(800);
		expect(t.y).toBeLessThan(600);

		camera.dispose();
	});
});

describe("fit", () => {
	test("frames all content, centered, at the largest level that still fits", () => {
		const camera = create_camera({ animation_ms: 0 });
		camera.set_viewport({ width: 1000, height: 800 });
		camera.set_content_bounds({ x: 0, y: 0, w: 500, h: 400 });

		camera.fit();

		const t = camera.transform();
		expect(t.scale).toBe(LEVEL_SCALE[camera.level()]);
		const center_x = t.x + (0 + 250) * t.scale;
		const center_y = t.y + (0 + 200) * t.scale;
		expect(center_x).toBeCloseTo(500, 6);
		expect(center_y).toBeCloseTo(400, 6);

		camera.dispose();
	});

	test("falls back to map when content is larger than any level can fit", () => {
		const camera = create_camera({ animation_ms: 0 });
		camera.set_viewport({ width: 400, height: 300 });
		camera.set_content_bounds({ x: 0, y: 0, w: 5000, h: 4000 });

		camera.fit();

		expect(camera.level()).toBe("map");

		camera.dispose();
	});
});

describe("is_moving", () => {
	test("true while dragging, false once released", () => {
		const camera = create_camera({ animation_ms: 0 });
		expect(camera.is_moving()).toBe(false);
		camera.on_pointer_down({ clientX: 0, clientY: 0 });
		expect(camera.is_moving()).toBe(true);
		camera.on_pointer_move({ clientX: 10, clientY: 10 });
		expect(camera.is_moving()).toBe(true);
		camera.on_pointer_up();
		expect(camera.is_moving()).toBe(false);
		camera.dispose();
	});
});

describe("handle_key", () => {
	test("0 fits, +/- step levels, arrows pan", () => {
		const camera = create_camera({ animation_ms: 0 });
		camera.set_viewport({ width: 800, height: 600 });

		camera.handle_key({ key: "+" });
		expect(camera.level()).toBe("neighborhood");

		camera.handle_key({ key: "-" });
		expect(camera.level()).toBe("map");

		const before = camera.transform();
		camera.handle_key({ key: "ArrowRight" });
		expect(camera.transform().x).toBeLessThan(before.x);

		camera.set_content_bounds({ x: 0, y: 0, w: 200, h: 150 });
		camera.handle_key({ key: "0" });
		expect(camera.transform().scale).toBe(LEVEL_SCALE[camera.level()]);

		camera.dispose();
	});
});
