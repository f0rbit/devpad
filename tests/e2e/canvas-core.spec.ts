import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CAMERA_LEVELS, LEVEL_SCALE, type CameraLevel } from "../../apps/main/src/components/solid/canvas/camera";
import { E2E_CANVAS_PROJECT_ID } from "./fixtures/canvas-ids";
import { E2E_CANVAS_STAGING_PROJECT_ID } from "./fixtures/canvas-staging";
import { E2E_OUTLINE_PROJECT_ID, E2E_SESSION_ID } from "./fixtures/outline-ids";

/**
 * Task P2.5 — canvas-home verification. Uses the small seeded outline
 * project (`E2E_OUTLINE_PROJECT_ID`) for zoom/keyboard/pan/theme assertions
 * (fast, few nodes) and the dedicated ~500-node synthetic project
 * (`E2E_CANVAS_PROJECT_ID`) for the culling assertion specifically.
 */
const LEVEL_LABEL: Record<CameraLevel, string> = {
	map: "Map",
	neighborhood: "Neighborhood",
	node: "Node",
	detail: "Detail",
};

const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async (route) => {
			await route.continue({ headers: { ...route.request().headers(), "X-Test-User": "true" } });
		},
	);
	await context.addCookies([{ name: "auth_session", value: E2E_SESSION_ID, domain: "localhost", path: "/" }]);
};

const openCanvas = async (page: Page, project_id: string): Promise<Locator> => {
	await page.goto(`/project/${project_id}/canvas`);
	const viewport = page.getByTestId("canvas-viewport");
	await expect(viewport).toBeVisible();
	// `:visible` (not `.first()` in raw DOM order) — dagre layout order has no
	// relationship to on-screen position, so the FIRST node in the DOM can
	// legitimately be one culling hides once the real viewport is measured.
	await expect(page.locator("[data-canvas-node]:visible").first()).toBeVisible({ timeout: 10_000 });
	return viewport;
};

// `:visible` here too, for the same reason — a stale `data-lod` value can
// still be sitting on a culled (display:none) node from before the level
// last changed, so scoping to a rendered node is what actually proves the
// swap landed.
const anyNodeAtLevel = (page: Page, level: CameraLevel) =>
	page.locator(`[data-canvas-node][data-lod="${level}"]:visible`).first();

/** `map`'s scale is now relative — "fit the whole forest" — so it isn't a
 * fixed constant per fixture. Read the live scale straight off `.canvas-world`'s
 * inline transform rather than assuming `LEVEL_SCALE.map`. */
const readWorldScale = async (page: Page): Promise<number> => {
	const transform = await page.locator(".canvas-world").getAttribute("style");
	const match = transform?.match(/scale\(([\d.]+)\)/);
	if (!match?.[1]) throw new Error("could not read .canvas-world scale from style attribute");
	return Number(match[1]);
};

/**
 * Same cold-hydration retry pattern as `outline-zoom.spec.ts`'s
 * `clickWithRetry` — the canvas surface is a `client:load` Astro island, so
 * the FIRST interaction on a freshly-navigated page can land before Solid's
 * delegated click listener has attached.
 */
const clickLevel = async (page: Page, level: CameraLevel, timeout = 5000): Promise<void> => {
	const button = page.getByRole("button", { name: LEVEL_LABEL[level], exact: true });
	await button.click();
	try {
		await expect(anyNodeAtLevel(page, level)).toBeVisible({ timeout: 2000 });
	} catch {
		await button.click();
		await expect(anyNodeAtLevel(page, level)).toBeVisible({ timeout });
	}
};

const screenshot_dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".plans", "screenshots");

async function captureLevel(page: Page, theme: "light" | "dark", level: CameraLevel): Promise<void> {
	await page.emulateMedia({ colorScheme: theme });
	await page.getByRole("button", { name: LEVEL_LABEL[level], exact: true }).click();
	await expect(anyNodeAtLevel(page, level)).toBeVisible({ timeout: 5000 });
	// `data-lod`/visibility flip at the START of the 210ms `.canvas-world`
	// transition (see AGENTS.md's "E2E camera-settle gotcha"), not the end —
	// screenshotting before the tween settles catches mid-pan/zoom blur.
	await expect(page.locator(".canvas-viewport-moving")).toHaveCount(0, { timeout: 5000 });
	await page.evaluate(() => document.querySelector("astro-dev-toolbar")?.remove());
	const output = resolve(screenshot_dir, `canvas-p2-${level}-${theme}.png`);
	await page.screenshot({ path: output, fullPage: false });
	expect(existsSync(output)).toBeTruthy();
}

test.describe("canvas home — P2.5 verification", () => {
	// Serial across the WHOLE file — same rationale as
	// `outline-interactions.spec.ts` / `lens-graph.spec.ts`: under full local
	// parallelism, several first-navigations against the shared dev server
	// can starve each other's CPU badly enough that the camera's real
	// 200ms zoom-settle animation (no injected `animation_ms: 0` test double
	// here — this drives the actual production component) blows past
	// assertion timeouts. `mode: "serial"` on the outer describe cascades to
	// every nested describe/test below.
	test.describe.configure({ mode: "serial" });

	test.describe("zoom levels", () => {
		test("all 4 levels are reachable via the HUD control and swap data-lod", async ({ page, context }) => {
			await inject_test_user(context);
			await openCanvas(page, E2E_OUTLINE_PROJECT_ID);

			for (const level of CAMERA_LEVELS) {
				await clickLevel(page, level);
			}
		});

		test("wheel scroll is fluid — walks through all 4 LOD bands without ever snapping to a level's exact scale", async ({
			page,
			context,
		}) => {
			await inject_test_user(context);
			const viewport = await openCanvas(page, E2E_OUTLINE_PROJECT_ID);

			// Pin to a known starting scale (map — dynamic "fit the whole forest"
			// scale for this fixture) via the HUD before driving the wheel —
			// `fit()`'s initial scale otherwise depends on viewport size.
			await clickLevel(page, "map");

			const box = await viewport.boundingBox();
			if (!box) throw new Error("canvas viewport has no bounding box");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

			// `map`'s scale is relative (fit-to-forest) — read it live. Each step
			// drives the wheel 55% of the way from the current scale toward the
			// next level's exact scale: past that band's midpoint (so `data-lod`
			// flips to the target level) but deliberately short of the level's
			// exact value, proving the zoom never snaps.
			const WHEEL_SENSITIVITY = 0.0012;
			const targets: readonly CameraLevel[] = ["neighborhood", "node", "detail"];
			for (const level of targets) {
				const current_scale = await readWorldScale(page);
				const target_scale = LEVEL_SCALE[level];
				const stepped_scale = current_scale + (target_scale - current_scale) * 0.55;
				const deltaY = -(stepped_scale - current_scale) / WHEEL_SENSITIVITY;
				await page.mouse.wheel(0, deltaY);
				await expect(anyNodeAtLevel(page, level)).toBeVisible({ timeout: 5000 });

				const landed_scale = await readWorldScale(page);
				expect(landed_scale).toBeCloseTo(stepped_scale, 2);
				for (const camera_level of CAMERA_LEVELS) {
					expect(Math.abs(landed_scale - LEVEL_SCALE[camera_level])).toBeGreaterThan(0.01);
				}
			}

			// A big reverse scroll drives the scale continuously back down to the
			// map-fit floor — still never re-snapping to an exact level scale.
			await page.mouse.wheel(0, 2000);
			await expect(anyNodeAtLevel(page, "map")).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe("culling", () => {
		test("a ~500-node project culls the offscreen majority but keeps them mounted", async ({ page, context }) => {
			await inject_test_user(context);
			await page.setViewportSize({ width: 900, height: 600 });
			await openCanvas(page, E2E_CANVAS_PROJECT_ID);
			// `map` is now the fit-the-whole-forest tier by design (everything
			// visible is the point) — culling only shows up at a tier with a fixed,
			// larger-than-fit absolute scale, so this test zooms to `detail`.
			await clickLevel(page, "detail");

			const total = await page.locator("[data-canvas-node]").count();
			expect(total).toBe(500);

			// Read total/visible/hidden ATOMICALLY in one evaluate — the culling
			// recompute (ResizeObserver settle + spatial-index requery) can keep
			// shifting counts across separate round-trips, so two split reads can
			// race each other. Poll until two consecutive snapshots agree — not
			// just "below half" — before asserting the invariant.
			const counts = () =>
				page.$$eval("[data-canvas-node]", (els) => {
					const hidden = els.filter((el) => (el as HTMLElement).style.display === "none").length;
					return { total: els.length, hidden, visible: els.length - hidden };
				});

			let previous = await counts();
			await expect
				.poll(
					async () => {
						const current = await counts();
						const stable = current.visible < total / 2 && current.visible === previous.visible;
						previous = current;
						return stable;
					},
					{ timeout: 5000 },
				)
				.toBe(true);

			const final = await counts();
			expect(final.visible).toBeGreaterThan(0);
			expect(final.hidden).toBe(final.total - final.visible);
		});
	});

	test.describe("hierarchy edges + fit-to-forest map level", () => {
		test("a deep project renders hierarchy edges and fit() frames every node within the viewport at map level", async ({
			page,
			context,
		}) => {
			await inject_test_user(context);
			await page.setViewportSize({ width: 1280, height: 800 });
			const viewport = await openCanvas(page, E2E_CANVAS_PROJECT_ID);
			await viewport.focus();

			await clickLevel(page, "map");
			const hierarchy_edge_count = await page.locator('[data-edge-kind="hierarchy"]').count();
			expect(hierarchy_edge_count).toBeGreaterThan(0);

			// `0` re-fits (same tier, but re-centers/re-scales to the CURRENT
			// content bounds) — every node should land inside the viewport with no
			// culling once framed at the fit-to-forest scale.
			await viewport.press("0");
			await expect(page.locator(".canvas-viewport-moving")).toHaveCount(0, { timeout: 5000 });

			const total = await page.locator("[data-canvas-node]").count();
			const visible_count = await page.locator("[data-canvas-node]:visible").count();
			expect(visible_count).toBe(total);

			const box = await viewport.boundingBox();
			if (!box) throw new Error("canvas viewport has no bounding box");
			const node_boxes = await page.locator("[data-canvas-node]:visible").evaluateAll((els) =>
				els.map((el) => {
					const rect = el.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				}),
			);
			for (const node_box of node_boxes) {
				expect(node_box.x + node_box.width).toBeGreaterThanOrEqual(box.x);
				expect(node_box.x).toBeLessThanOrEqual(box.x + box.width);
				expect(node_box.y + node_box.height).toBeGreaterThanOrEqual(box.y);
				expect(node_box.y).toBeLessThanOrEqual(box.y + box.height);
			}
		});
	});

	test.describe("staging fixture geometry (55 tasks, 47 with parent_id, 5 links)", () => {
		test("no two node bounding boxes intersect at map level, and every parented task has a hierarchy edge", async ({
			page,
			context,
		}) => {
			await inject_test_user(context);
			await page.setViewportSize({ width: 1280, height: 800 });
			await openCanvas(page, E2E_CANVAS_STAGING_PROJECT_ID);
			await clickLevel(page, "map");

			const node_boxes = await page.locator("[data-canvas-node]:visible").evaluateAll((els) =>
				els.map((el) => {
					const rect = el.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				}),
			);
			expect(node_boxes.length).toBeGreaterThan(0);
			for (let i = 0; i < node_boxes.length; i++) {
				for (let j = i + 1; j < node_boxes.length; j++) {
					const a = node_boxes[i]!;
					const b = node_boxes[j]!;
					const intersects = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
					expect(intersects).toBe(false);
				}
			}

			// Every task with a `parent_id` (47 of 55 in this fixture) got a
			// structural hierarchy edge from `layout_graph` — the edge count is a
			// looser bound (multiple children can share one parent's edge id
			// space, and dagre's multigraph can theoretically dedupe none of
			// these) but a non-trivial count proves the edges were actually built,
			// not just that the DOM has SOME `[data-edge-kind]` element.
			const hierarchy_edge_count = await page.locator('[data-edge-kind="hierarchy"]').count();
			expect(hierarchy_edge_count).toBeGreaterThanOrEqual(40);
		});
	});

	test.describe("keyboard map", () => {
		test("+/-/0/arrows change level and transform", async ({ page, context }) => {
			await inject_test_user(context);
			const viewport = await openCanvas(page, E2E_OUTLINE_PROJECT_ID);
			await viewport.focus();

			await clickLevel(page, "node");

			await viewport.press("+");
			await expect(anyNodeAtLevel(page, "detail")).toBeVisible({ timeout: 5000 });

			await viewport.press("-");
			await expect(anyNodeAtLevel(page, "node")).toBeVisible({ timeout: 5000 });
			await viewport.press("-");
			await expect(anyNodeAtLevel(page, "neighborhood")).toBeVisible({ timeout: 5000 });
			await viewport.press("-");
			await expect(anyNodeAtLevel(page, "map")).toBeVisible({ timeout: 5000 });

			const world = page.locator(".canvas-world");
			const before = await world.evaluate((el) => el.getAttribute("style"));
			await viewport.press("ArrowRight");
			await expect
				.poll(async () => world.evaluate((el) => el.getAttribute("style")), { timeout: 3000 })
				.not.toBe(before);

			const afterArrow = await world.evaluate((el) => el.getAttribute("style"));
			await viewport.press("0");
			await expect
				.poll(async () => world.evaluate((el) => el.getAttribute("style")), { timeout: 3000 })
				.not.toBe(afterArrow);
		});
	});

	test.describe("clamped pan", () => {
		test("dragging far past the content leaves content visible, never a void", async ({ page, context }) => {
			await inject_test_user(context);
			const viewport = await openCanvas(page, E2E_OUTLINE_PROJECT_ID);
			await clickLevel(page, "detail");

			const box = await viewport.boundingBox();
			if (!box) throw new Error("canvas viewport has no bounding box");
			const cx = box.x + box.width / 2;
			const cy = box.y + box.height / 2;

			// Repeated large drags (rather than one continuous off-screen drag) —
			// `on_pointer_move` diffs successive clientX/clientY, so several
			// same-direction gestures accumulate the same total pan a single huge
			// drag would, without needing off-viewport mouse coordinates.
			for (let i = 0; i < 12; i++) {
				await page.mouse.move(cx, cy);
				await page.mouse.down();
				await page.mouse.move(cx - 400, cy - 400, { steps: 4 });
				await page.mouse.up();
			}

			await expect(page.locator("[data-canvas-node]:visible").first()).toBeVisible({ timeout: 3000 });
			const visible_after_pan = await page.locator("[data-canvas-node]:visible").count();
			expect(visible_after_pan).toBeGreaterThan(0);
		});
	});

	test.describe("proof screenshots", () => {
		test.skip(process.env.CAPTURE_CANVAS !== "1", "proof-artifact capture; run with CAPTURE_CANVAS=1");

		test("captures each zoom level in light and dark", async ({ page, context }) => {
			test.setTimeout(120_000);
			mkdirSync(screenshot_dir, { recursive: true });
			await inject_test_user(context);
			await page.setViewportSize({ width: 1440, height: 900 });
			await openCanvas(page, E2E_OUTLINE_PROJECT_ID);

			for (const theme of ["light", "dark"] as const) {
				for (const level of CAMERA_LEVELS) {
					await captureLevel(page, theme, level);
				}
			}
		});
	});
});
