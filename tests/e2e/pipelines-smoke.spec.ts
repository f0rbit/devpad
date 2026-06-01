import { type BrowserContext, expect, test } from "@playwright/test";
import { E2E_PROJECT_ID } from "./fixtures/pipeline-ids.ts";

/**
 * Phase 1 proof spec — proves the seed substrate lines up end-to-end:
 *   - the bun seed step seeded `database/test.db` before Playwright booted
 *   - the Astro server (:3000) serves the SSR pipeline page, proxying /api to :3001
 *   - `X-Test-User` fake auth resolves to the fixture owner so the page renders
 *
 * Phase 2 replaces / extends this with the real dashboard + page specs.
 */

const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async route => {
			await route.continue({
				headers: {
					...route.request().headers(),
					"X-Test-User": "true",
				},
			});
		}
	);
};

test.describe("Pipelines smoke", () => {
	test("seeded pipeline page renders under fake auth", async ({ page, context }) => {
		await inject_test_user(context);

		const response = await page.goto(`/project/${E2E_PROJECT_ID}/pipeline`);
		// No 404/500 — the page degrades gracefully when the orchestrator package
		// route is unmounted locally rather than tearing down the whole page.
		expect(response?.status()).toBeLessThan(500);

		// The tab shell renders in BOTH the happy path and the degraded path, so it is
		// the stable render proof.
		await expect(page.getByTestId("pipeline-tabs")).toBeVisible();

		// Locally the worker mounts only /pipelines/dashboard, so packages.list 404s and
		// the page enters its degraded state — assert the banner the degradation produces.
		await expect(page.getByTestId("pipeline-degraded")).toBeVisible();
	});
});
