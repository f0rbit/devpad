import { type BrowserContext, type ConsoleMessage, expect, test } from "@playwright/test";
import { E2E_EXTERNAL_PROJECT_ID, E2E_RUN_EXT_AWAITING, E2E_RUN_EXT_UNCONFIRMED } from "./fixtures/pipeline-ids";

/**
 * External deploy mode (#155) — render-level coverage for the external
 * fixtures under the local harness.
 *
 * Local reality: the orchestrator routes (`/packages`, `/runs/:id`) 404/503
 * from the worker proxy, so the pipeline page ALWAYS renders its degraded
 * shell and the run-detail page its degraded banner. The orchestrator-backed
 * widgets (external badge, dispatch ledger, re-dispatch, unconfirmed banner)
 * are therefore NOT observable locally — their logic is asserted through SSR
 * render invariants that don't lie here (page < 500, degraded banner, no
 * severe console/page errors) plus the LOCAL dashboard route, which reads the
 * seeded rows straight out of local D1 and proves the external fixtures
 * actually landed (2 external runs → data-run-total="2").
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

const is_severe = (msg: ConsoleMessage): boolean => {
	if (msg.type() !== "error") return false;
	const text = msg.text().toLowerCase();
	const known_noise = ["favicon", "failed to load resource", "the server responded with a status of 4", "net::err"];
	return !known_noise.some((n) => text.includes(n));
};

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

test.describe("Pipelines external deploy mode (fixtures render)", () => {
	test("external project's pipeline page degrades safely (no 5xx, no severe errors)", async ({ page, context }) => {
		await inject_test_user(context);
		const errors = collect_errors(page);

		const response = await page.goto(`/project/${E2E_EXTERNAL_PROJECT_ID}/pipeline?tab=runs`);
		expect(response?.status()).toBeLessThan(500);

		await expect(page.getByTestId("pipeline-tabs")).toBeVisible();
		await expect(page.getByTestId("pipeline-degraded")).toBeVisible();
		await expect(page.getByTestId("pipeline-tab-runs")).toHaveClass(/active/);

		expect(errors(), "severe console / page errors on external project pipeline page").toEqual([]);
	});

	test("external fixtures are visible to the local dashboard route (2 runs seeded)", async ({ page, context }) => {
		await inject_test_user(context);
		const errors = collect_errors(page);

		// The dashboard aggregator reads pipeline_run rows from local D1
		// (no orchestrator hop) — this is the observable proof that the
		// external package's two runs (awaiting_approval + unconfirmed)
		// seeded correctly and don't crash the aggregator's targeting
		// (both carry commit_sha, version_set_id null).
		const response = await page.goto(`/project/${E2E_EXTERNAL_PROJECT_ID}/pipeline?tab=dashboard`);
		expect(response?.status()).toBeLessThan(500);

		await expect(page.getByTestId("pipeline-dashboard")).toBeVisible();
		await expect(page.getByTestId("dashboard-run-total")).toHaveAttribute("data-run-total", "2");

		expect(errors(), "severe console / page errors on external project dashboard").toEqual([]);
	});

	test("external run-detail pages degrade safely for both external run shapes", async ({ page, context }) => {
		await inject_test_user(context);

		for (const run_id of [E2E_RUN_EXT_AWAITING, E2E_RUN_EXT_UNCONFIRMED]) {
			const response = await page.goto(`/project/${E2E_EXTERNAL_PROJECT_ID}/pipeline/runs/${run_id}`);
			expect(response?.status()).toBeLessThan(500);
			await expect(page.getByTestId("pipeline-degraded")).toBeVisible();
		}
	});
});
