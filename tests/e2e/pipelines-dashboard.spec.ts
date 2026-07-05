import { type BrowserContext, expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, E2E_PROJECT_NO_PKG } from "./fixtures/pipeline-ids.ts";

/**
 * Task 2.1 — dashboard tab aggregated counts.
 *
 * Local scope (plan task-2-0 → Option a): the dashboard tab is the ONE pipelines
 * surface backed by a route the local worker actually serves
 * (`/api/v1/pipelines/dashboard`, reads D1 directly). The seed fixture inserts 2
 * runs (1 completed + 1 awaiting_approval) with `started_at` anchored ~2h ago, so
 * both fall inside the default 24h dashboard window and `run_counts.total` is
 * deterministically 2 (1 completed). We assert against the rendered DOM via stable
 * testids, NOT the API and NOT volatile copy.
 *
 * The page renders the dashboard tab even though `packages.list()` (an orchestrator
 * route) 404s locally and the page is in its `degraded` state — the dashboard fetch
 * is keyed by PROJECT, not package, and is lifted out of the package guard. So the
 * count is live even under degradation.
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

test.describe("Pipelines dashboard", () => {
	test("dashboard tab renders the seeded total run count (2)", async ({ page, context }) => {
		await inject_test_user(context);

		// Fresh navigation — the dashboard endpoint sets Cache-Control max-age=30, so
		// never reuse a cached page; each test does its own goto.
		const response = await page.goto(`/project/${E2E_PROJECT_ID}/pipeline?tab=dashboard`);
		expect(response?.status()).toBeLessThan(500);

		// Dashboard component mounted (client:load).
		await expect(page.getByTestId("pipeline-dashboard")).toBeVisible();

		// Total = 2 (the two seeded runs). Assert on the data attribute carrying the
		// raw number rather than the formatted copy, so locale formatting never breaks it.
		const total = page.getByTestId("dashboard-run-total");
		await expect(total).toBeVisible();
		await expect(total).toHaveAttribute("data-run-total", "2");

		// The seed guarantees exactly 1 completed run.
		const completed = page.getByTestId("dashboard-run-completed");
		await expect(completed).toHaveAttribute("data-run-completed", "1");
	});

	test("no-package project does not render the dashboard counts panel", async ({ page, context }) => {
		await inject_test_user(context);

		// A project with no pipeline_package. Locally `packages.list()` 404s for every
		// project (orchestrator route), so this project enters the page's `degraded`
		// state and shows the degraded banner rather than the true empty state — the
		// local 404 can't distinguish "no package" from "service down". The dashboard
		// aggregator still returns an empty (zero) snapshot for this project, so the
		// dashboard component renders its <Empty> state (no run-counts panel). We assert
		// the page does not crash and the seeded-count panel is ABSENT.
		const response = await page.goto(`/project/${E2E_PROJECT_NO_PKG}/pipeline?tab=dashboard`);
		expect(response?.status()).toBeLessThan(500);

		// Page shell rendered, no crash.
		await expect(page.getByTestId("pipeline-tabs")).toBeVisible();

		// The run-total panel from the happy fixture must NOT appear for the empty project.
		await expect(page.getByTestId("dashboard-run-total")).toHaveCount(0);
	});
});
