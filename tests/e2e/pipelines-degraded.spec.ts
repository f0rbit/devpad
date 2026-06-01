import { type BrowserContext, type ConsoleMessage, expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, E2E_PROJECT_NO_PKG } from "./fixtures/pipeline-ids.ts";

/**
 * Task 2.3 — degradation cases (local-worker scope, plan task-2-0 → Option a).
 *
 * (a) No-package project.
 *     SCOPE NUANCE: the plan asks for the true `pipeline-empty` state, but locally
 *     `packages.list()` is an orchestrator route that 404s for EVERY project. The
 *     page can't tell "no package" (would be `pipeline-empty`) from "service down"
 *     (is `pipeline-degraded`) — both produce a non-ok `packages.list()` Result, and
 *     the page resolves that to the degraded shell. So locally a no-package project
 *     renders `pipeline-degraded`, NOT `pipeline-empty`. We assert the degraded shell
 *     renders without a crash. The true empty-state assertion is DEFERRED until the
 *     orchestrator is stood up locally (out-of-scope).
 *
 * (b) Pulse unreachable.
 *     The dashboard aggregator only fetches pulse when `pulse_api_base` +
 *     `pulse_internal_key` are configured (see `pipelines-dashboard.ts`
 *     `try_pulse_summary`); locally neither is set, so it short-circuits to
 *     `pulse: null` WITHOUT any outbound request — there is nothing to intercept with
 *     `context.route()`. This IS the pulse-unreachable path the plan targets, reached
 *     via the local default. We assert the dashboard still renders its run counts (2)
 *     with no error banner — degradation is silent.
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

const is_severe = (msg: ConsoleMessage): boolean => {
	if (msg.type() !== "error") return false;
	const text = msg.text().toLowerCase();
	const known_noise = ["favicon", "failed to load resource", "the server responded with a status of 4", "net::err"];
	return !known_noise.some(n => text.includes(n));
};

const collect_errors = (page: import("@playwright/test").Page) => {
	const severe: string[] = [];
	page.on("console", msg => {
		if (is_severe(msg)) severe.push(`console.error: ${msg.text()}`);
	});
	page.on("pageerror", err => {
		severe.push(`pageerror: ${err.message}`);
	});
	return () => severe;
};

test.describe("Pipelines degradation", () => {
	test("no-package project renders the degraded shell, not a crash", async ({ page, context }) => {
		await inject_test_user(context);
		const errors = collect_errors(page);

		const response = await page.goto(`/project/${E2E_PROJECT_NO_PKG}/pipeline?tab=dashboard`);
		expect(response?.status()).toBeLessThan(500);

		// Local reality (see header): degraded shell, not the true empty state.
		await expect(page.getByTestId("pipeline-tabs")).toBeVisible();
		await expect(page.getByTestId("pipeline-degraded")).toBeVisible();

		// No seeded run-counts panel for the package-less project.
		await expect(page.getByTestId("dashboard-run-total")).toHaveCount(0);

		expect(errors(), "severe console / page errors on no-package project").toEqual([]);
	});

	test("dashboard renders run counts with pulse unreachable (pulse: null), no error surfaced", async ({ page, context }) => {
		await inject_test_user(context);
		const errors = collect_errors(page);

		// Locally pulse is unconfigured → aggregator returns `pulse: null` with no
		// outbound fetch. This is the pulse-unreachable path via the local default.
		const response = await page.goto(`/project/${E2E_PROJECT_ID}/pipeline?tab=dashboard`);
		expect(response?.status()).toBeLessThan(500);

		// Dashboard still renders its counts despite pulse being absent.
		await expect(page.getByTestId("pipeline-dashboard")).toBeVisible();
		await expect(page.getByTestId("dashboard-run-total")).toHaveAttribute("data-run-total", "2");

		// No dashboard error banner is shown to the user (degradation is silent).
		await expect(page.locator("[data-testid='pipeline-dashboard'] >> text=/failed to load/i")).toHaveCount(0);

		expect(errors(), "severe console / page errors with pulse unreachable").toEqual([]);
	});
});
