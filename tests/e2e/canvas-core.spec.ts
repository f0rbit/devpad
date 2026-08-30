import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { CAMERA_LEVELS, type CameraLevel } from "../../apps/main/src/components/solid/canvas/camera";
import { E2E_CANVAS_PROJECT_ID } from "./fixtures/canvas-ids";
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

		test("wheel scroll snaps through all 4 levels in sequence", async ({ page, context }) => {
			await inject_test_user(context);
			const viewport = await openCanvas(page, E2E_OUTLINE_PROJECT_ID);

			// Pin to a known starting scale (map, 0.58) via the HUD before driving
			// the wheel — `fit()`'s initial scale otherwise depends on viewport size.
			await clickLevel(page, "map");

			const box = await viewport.boundingBox();
			if (!box) throw new Error("canvas viewport has no bounding box");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

			// Each step's deltaY lands the wheel's `on_wheel` math (delta = -deltaY *
			// 0.0012) on the NEXT level's exact target scale, so `nearest_level`'s
			// settle picks it deterministically rather than approximately.
			const steps: Array<{ readonly deltaY: number; readonly level: CameraLevel }> = [
				{ deltaY: -200, level: "neighborhood" }, // 0.58 -> 0.82
				{ deltaY: -150, level: "node" }, // 0.82 -> 1.00
				{ deltaY: -67, level: "detail" }, // 1.00 -> 1.08
			];
			for (const step of steps) {
				await page.mouse.wheel(0, step.deltaY);
				await expect(anyNodeAtLevel(page, step.level)).toBeVisible({ timeout: 5000 });
			}

			// A big reverse scroll snaps straight back down to the min level.
			await page.mouse.wheel(0, 2000);
			await expect(anyNodeAtLevel(page, "map")).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe("culling", () => {
		test("a ~500-node project culls the offscreen majority but keeps them mounted", async ({ page, context }) => {
			await inject_test_user(context);
			await page.setViewportSize({ width: 900, height: 600 });
			await openCanvas(page, E2E_CANVAS_PROJECT_ID);
			await clickLevel(page, "map");

			const total = await page.locator("[data-canvas-node]").count();
			expect(total).toBe(500);

			// The visible count only settles once the `ResizeObserver` has
			// measured the real viewport and `visibleIds` has recomputed off it
			// (before that, `visibleIds()` is `null` — "render everything") — poll
			// rather than assert immediately.
			await expect
				.poll(async () => page.locator("[data-canvas-node]:visible").count(), { timeout: 5000 })
				.toBeLessThan(total / 2);

			const visible_count = await page.locator("[data-canvas-node]:visible").count();
			expect(visible_count).toBeGreaterThan(0);

			const hidden_count = await page.$$eval(
				"[data-canvas-node]",
				(els) => els.filter((el) => (el as HTMLElement).style.display === "none").length,
			);
			expect(hidden_count).toBe(total - visible_count);
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
