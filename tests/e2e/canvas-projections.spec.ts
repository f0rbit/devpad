import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
	E2E_CANVAS_P3_AGENT_CHILD,
	E2E_CANVAS_P3_CHILD,
	E2E_CANVAS_P3_PROJECT_ID,
} from "./fixtures/canvas-p3-ids";
import { E2E_SESSION_ID } from "./fixtures/outline-ids";

/**
 * Task P3.5 — canvas-home P3 verification (view-state persistence,
 * agent-created placement cue, semantic travel, lazy projections). Kept in
 * its own file rather than appended to `canvas-core.spec.ts` — P2's file is
 * already the culling/zoom/pan/keyboard baseline; P3 exercises a
 * substantially different surface (drag, network round-trips, travel) and
 * doesn't need to share P2's serial-mode/CPU-contention rationale beyond
 * what this file declares for itself.
 */

const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async (route) => {
			await route.continue({ headers: { ...route.request().headers(), "X-Test-User": "true" } });
		},
	);
	await context.addCookies([{ name: "auth_session", value: E2E_SESSION_ID, domain: "localhost", path: "/" }]);
};

const openCanvas = async (page: Page): Promise<void> => {
	// `/canvas` now 301s to `/project/:id` (P4.1 IA absorption) before the
	// cold `client:load` island hydrates — the extra redirect hop pushes the
	// FIRST navigation in this file past the default 5s visibility timeout
	// often enough to matter; match the node-visibility timeout below.
	await page.goto(`/project/${E2E_CANVAS_P3_PROJECT_ID}/canvas`);
	await expect(page.getByTestId("canvas-viewport")).toBeVisible({ timeout: 10_000 });
	await expect(page.locator("[data-canvas-node]:visible").first()).toBeVisible({ timeout: 10_000 });
};

const nodeFor = (page: Page, task_id: string) => page.locator(`[data-canvas-node][data-task-id="${task_id}"]`);

/** Matches `.canvas-world`'s CSS `transition: transform 210ms` — a level's `data-lod` attribute flips at animation START, not end, so any code reading on-screen POSITIONS (a `boundingBox()` for a drag, not just presence) has to wait out the tween too. */
const CAMERA_SETTLE_MS = 300;

/**
 * Same cold-hydration retry pattern as `canvas-core.spec.ts`'s `clickLevel`
 * — the canvas surface is a `client:load` Astro island, so the FIRST
 * interaction on a freshly-navigated page can land before Solid's
 * delegated click listener has attached.
 */
const clickLevel = async (page: Page, label: "Map" | "Neighborhood" | "Node" | "Detail"): Promise<void> => {
	const button = page.getByRole("button", { name: label, exact: true });
	await button.click();
	try {
		await expect(page.locator(`[data-canvas-node][data-lod="${label.toLowerCase()}"]:visible`).first()).toBeVisible({
			timeout: 2000,
		});
	} catch {
		await button.click();
		await expect(page.locator(`[data-canvas-node][data-lod="${label.toLowerCase()}"]:visible`).first()).toBeVisible({
			timeout: 5000,
		});
	}
	await page.waitForTimeout(CAMERA_SETTLE_MS);
};

const screenshot_dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".plans", "screenshots");

test.describe("canvas home — P3 verification", () => {
	// Same rationale as canvas-core.spec.ts: real (unfaked) camera-settle
	// animations + a shared dev server mean full parallelism can starve
	// individual tests' assertion timeouts.
	test.describe.configure({ mode: "serial" });

	test("dragging a node pins it, persists across reload, and reset clears it", async ({ page, context }) => {
		await inject_test_user(context);
		await page.setViewportSize({ width: 1440, height: 900 });
		await openCanvas(page);

		// Select the target at `map` LOD first (focuses the camera on it, per
		// `canvas-surface.tsx`'s `set_focus` effect) so the "Node" LOD zoom
		// below centers it on screen deterministically rather than landing
		// wherever the unfocused content-bounds center happened to be.
		await nodeFor(page, E2E_CANVAS_P3_CHILD).click();
		await page.waitForTimeout(350);

		// "Node" LOD — the full 250x124 card, not the tiny 20px map dot, so the
		// simulated drag has a reliable hit-target.
		await clickLevel(page, "Node");
		const node = nodeFor(page, E2E_CANVAS_P3_CHILD);
		await expect(node).toBeVisible();
		const box = await node.boundingBox();
		if (!box) throw new Error("node has no bounding box");

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		// Well past the 4px drag threshold.
		await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 8 });
		await page.mouse.up();

		await expect(node).toHaveAttribute("data-pinned", "true");
		await expect(page.getByTestId("canvas-reset-layout")).toBeVisible();

		// The PUT is debounced (VIEW_STATE_SAVE_DEBOUNCE_MS = 500ms) — wait past
		// it before reloading, or the reload can race an in-flight/not-yet-fired
		// save and reload against the OLD server-side layout.
		await page.waitForTimeout(700);

		// A fresh navigation re-fetches view-state from the server — proves the
		// pin was actually persisted, not just held in the page's own memory.
		await page.reload();
		await expect(page.getByTestId("canvas-viewport")).toBeVisible();
		await expect(nodeFor(page, E2E_CANVAS_P3_CHILD)).toHaveAttribute("data-pinned", "true", { timeout: 10_000 });

		// Reload just landed — same cold-hydration first-interaction race as the
		// initial HUD clicks, so this click gets the same retry.
		const resetButton = page.getByTestId("canvas-reset-layout");
		await resetButton.click();
		try {
			await expect(nodeFor(page, E2E_CANVAS_P3_CHILD)).toHaveAttribute("data-pinned", "false", { timeout: 2000 });
		} catch {
			await resetButton.click();
			await expect(nodeFor(page, E2E_CANVAS_P3_CHILD)).toHaveAttribute("data-pinned", "false", { timeout: 5000 });
		}
		await expect(page.getByTestId("canvas-reset-layout")).toBeHidden();
		// reset fires its PUT immediately (no debounce) but it's still an
		// in-flight network request — give it a moment before reloading.
		await page.waitForTimeout(500);

		await page.reload();
		await expect(page.getByTestId("canvas-viewport")).toBeVisible();
		await expect(nodeFor(page, E2E_CANVAS_P3_CHILD)).toHaveAttribute("data-pinned", "false", { timeout: 10_000 });
	});

	test("an unpinned agent-created node shows the programmatic-placement cue", async ({ page, context }) => {
		await inject_test_user(context);
		await openCanvas(page);

		const agent_node = nodeFor(page, E2E_CANVAS_P3_AGENT_CHILD);
		await expect(agent_node).toHaveAttribute("data-programmatic", "true");
		// The HUD "Node" level click moves the camera off `map`, which is what
		// triggers the one-time placement cue.
		await clickLevel(page, "Node");
		await expect(agent_node).toHaveClass(/canvas-node-cue/, { timeout: 5000 });
	});

	test("Enter travels into a node and updates the breadcrumb; Escape travels back up", async ({ page, context }) => {
		await inject_test_user(context);
		await page.setViewportSize({ width: 1440, height: 900 });
		await openCanvas(page);
		// The dev-only Astro toolbar can float over the viewport and intercept a
		// click landing near it — drop it before interacting.
		await page.evaluate(() => document.querySelector("astro-dev-toolbar")?.remove());
		// "Node" LOD — a real 250x124 target, not the ~12px `map`-scale dot,
		// which is fragile to hit precisely via a synthesized click.
		await clickLevel(page, "Node");

		const node = nodeFor(page, E2E_CANVAS_P3_CHILD);
		await node.click();
		await node.press("Enter");

		await expect(page.getByTestId("canvas-crumb-current")).toHaveText("Canvas P3 child");

		await page.getByTestId("canvas-viewport").press("Escape");
		await expect(page.getByTestId("canvas-crumb-current")).not.toHaveText("Canvas P3 child");
	});

	test("projection chips only load at node/detail LOD, never at map/neighborhood", async ({ page, context }) => {
		await inject_test_user(context);

		let docs_requests = 0;
		await page.route("**/docs?**", (route) => {
			docs_requests++;
			void route.continue();
		});

		await openCanvas(page);
		await clickLevel(page, "Map");
		await page.waitForTimeout(300);
		expect(docs_requests).toBe(0);

		await clickLevel(page, "Neighborhood");
		await page.waitForTimeout(300);
		expect(docs_requests).toBe(0);

		await clickLevel(page, "Node");
		await expect.poll(() => docs_requests, { timeout: 5000 }).toBeGreaterThan(0);
		const after_first_load = docs_requests;

		// Staying at node/detail LOD never re-fetches — one batched load per
		// project-graph revalidate, not per visible-set change.
		await clickLevel(page, "Detail");
		await page.waitForTimeout(300);
		expect(docs_requests).toBe(after_first_load);
	});

	test.describe("proof screenshots", () => {
		test.skip(process.env.CAPTURE_CANVAS !== "1", "proof-artifact capture; run with CAPTURE_CANVAS=1");

		test("captures a pinned node + the detail panel in light and dark", async ({ page, context }) => {
			test.setTimeout(60_000);
			mkdirSync(screenshot_dir, { recursive: true });
			await inject_test_user(context);
			await page.setViewportSize({ width: 1440, height: 900 });
			await openCanvas(page);
			await page.evaluate(() => document.querySelector("astro-dev-toolbar")?.remove());
			// The whole 3-task P3 fixture graph fits comfortably at "Node" scale
			// in this viewport — no need to select-then-zoom first.
			await clickLevel(page, "Node");

			const node = nodeFor(page, E2E_CANVAS_P3_CHILD);
			const box = await node.boundingBox();
			if (!box) throw new Error("node has no bounding box");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { steps: 8 });
			await page.mouse.up();

			// The drag's pointerup swallows the NEXT click (so a drag doesn't
			// also count as a click) — this first click consumes that
			// suppression; the click+Enter pair below is what actually travels.
			await node.click();
			await node.click();
			await node.press("Enter");
			await expect(page.getByTestId("canvas-node-detail-panel")).toBeVisible({ timeout: CAMERA_SETTLE_MS + 2000 });

			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.evaluate(() => document.querySelector("astro-dev-toolbar")?.remove());
				for (const level of ["node", "detail"] as const) {
					if (level === "detail") await clickLevel(page, "Detail");
					const output = resolve(screenshot_dir, `canvas-p3-${level}-${theme}.png`);
					await page.screenshot({ path: output, fullPage: false });
					expect(existsSync(output)).toBeTruthy();
				}
			}
		});
	});
});
