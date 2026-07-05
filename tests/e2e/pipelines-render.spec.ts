import { type BrowserContext, type ConsoleMessage, expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, E2E_RUN_AWAITING } from "./fixtures/pipeline-ids";

/**
 * Task 2.2 — pipeline page / tab render-smoke (local-worker scope, plan task-2-0 → Option a).
 *
 * Asserts RENDER + WIRING only, never interactive orchestrator round-trips. Local
 * reality: only `/api/v1/pipelines/dashboard` is served by the worker; the runs /
 * grants / templates / packages routes are orchestrator routes that 404 locally, so
 * the pipeline page enters its `degraded` state (banner + tab shell) for these tabs
 * rather than rendering live data. We therefore assert:
 *   - HTTP < 500 on every tab,
 *   - the tab shell (`pipeline-tabs`) OR the degraded banner is present,
 *   - no SEVERE console error / uncaught page error fires on load,
 *   - an invalid `?tab=` value falls back to the default `runs` tab.
 *
 * Run-detail scope note: the run-detail page (`/pipeline/runs/:id`) calls
 * `packages.list()` and `rethrow()`s on failure, so it HARD-404s locally (it does NOT
 * degrade). We assert that documented behaviour (a 4xx, not a 5xx / crash) instead of
 * asserting StageGate renders — wiring StageGate is only observable with the
 * orchestrator stood up, which is out-of-scope for this plan.
 */

const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async (route) => {
			await route.continue({
				headers: {
					...route.request().headers(),
					"X-Test-User": "true",
				},
			});
		},
	);
};

/**
 * Only genuinely SEVERE problems should fail a render-smoke: uncaught exceptions and
 * React/Solid render errors. Expected local noise — network 404s from the unmounted
 * orchestrator routes, favicon, generic "Failed to load resource" — is filtered out.
 */
const is_severe = (msg: ConsoleMessage): boolean => {
	if (msg.type() !== "error") return false;
	const text = msg.text().toLowerCase();
	const known_noise = ["favicon", "failed to load resource", "the server responded with a status of 4", "net::err"];
	return !known_noise.some((n) => text.includes(n));
};

/** Attach console-error + pageerror collectors; returns a getter for accumulated severe errors. */
const collect_errors = (page: import("@playwright/test").Page) => {
	const severe: string[] = [];
	page.on("console", (msg) => {
		if (is_severe(msg)) severe.push(`console.error: ${msg.text()}`);
	});
	page.on("pageerror", (err) => {
		severe.push(`pageerror: ${err.message}`);
	});
	return () => severe;
};

const TABS = ["dashboard", "runs", "grants", "templates"] as const;

test.describe("Pipelines page render smoke", () => {
	for (const tab of TABS) {
		test(`?tab=${tab} renders the shell without a severe error`, async ({ page, context }) => {
			await inject_test_user(context);
			const errors = collect_errors(page);

			const response = await page.goto(`/project/${E2E_PROJECT_ID}/pipeline?tab=${tab}`);
			expect(response?.status()).toBeLessThan(500);

			// Shell present (tabs nav). The degraded banner accompanies it locally.
			await expect(page.getByTestId("pipeline-tabs")).toBeVisible();
			await expect(page.getByTestId("pipeline-degraded")).toBeVisible();

			// The requested tab is the active one.
			await expect(page.getByTestId(`pipeline-tab-${tab}`)).toHaveClass(/active/);

			expect(errors(), `severe console / page errors on ?tab=${tab}`).toEqual([]);
		});
	}

	test("invalid ?tab= falls back to the runs tab (VALID_TABS guard)", async ({ page, context }) => {
		await inject_test_user(context);
		const errors = collect_errors(page);

		const response = await page.goto(`/project/${E2E_PROJECT_ID}/pipeline?tab=bogus`);
		expect(response?.status()).toBeLessThan(500);

		await expect(page.getByTestId("pipeline-tabs")).toBeVisible();
		// Page's VALID_TABS guard defaults an unknown tab to `runs`.
		await expect(page.getByTestId("pipeline-tab-runs")).toHaveClass(/active/);

		expect(errors(), "severe console / page errors on invalid tab").toEqual([]);
	});

	test("run-detail page hard-404s locally (orchestrator packages.list unmounted)", async ({ page, context }) => {
		await inject_test_user(context);

		// SCOPE NOTE: `runs/[run_id].astro` does `packages.list()` then `rethrow()` on
		// failure — there is no graceful-degradation path on this page. Locally
		// packages.list 404s, so the page returns the rethrown 4xx. We assert it is a
		// clean client error (NOT a 5xx / SSR crash). Asserting StageGate renders for an
		// awaiting run is only meaningful with the orchestrator stood up (out-of-scope).
		const response = await page.goto(`/project/${E2E_PROJECT_ID}/pipeline/runs/${E2E_RUN_AWAITING}`);
		const status = response?.status() ?? 0;
		expect(status).toBeGreaterThanOrEqual(400);
		expect(status).toBeLessThan(500);
	});
});
