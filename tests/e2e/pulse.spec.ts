import { expect, test } from "@playwright/test";

/**
 * Phase 4B — pulse dashboard rendering smoke tests.
 *
 * The local e2e env doesn't have the pulse worker wired up — `pulse_api_base`
 * is unset on the dev worker, which makes the proxy short-circuit with 503
 * "Pulse integration not configured". That's exactly the unreachable path the
 * UI is supposed to handle gracefully, so these tests assert:
 *
 *   1. The /pulse page renders without 5xx and shows the tab nav.
 *   2. The unreachable banner appears (because pulse_api_base is unset).
 *   3. Each tab is reachable via ?tab= param.
 *   4. The project overview page still renders (PulseWidget is best-effort).
 *
 * Subscription CRUD is exercised against the Pulse worker in the pulse repo's
 * own e2e suite — replicating it here without a real upstream pulse worker is
 * not meaningful.
 */

const inject_test_user = async (context: any) => {
	await context.route(
		() => true,
		async (route: any) => {
			await route.continue({
				headers: {
					...route.request().headers(),
					"X-Test-User": "true",
				},
			});
		},
	);
};

const create_project = async (page: any, projectId: string) => {
	await page.goto("/project/create");
	await page.fill("#project_id", projectId);
	await page.fill("#name", `Pulse Test ${projectId}`);
	await page.fill("#description", "Pulse e2e fixture project");
	await page.selectOption("#status", "development");
	await page.selectOption("#visibility", "private");
	await page.click("#submit");
	await page.waitForURL(`/project/${projectId}`);
};

test.describe("Pulse dashboard", () => {
	test("project overview renders with PulseWidget even when pulse is unreachable", async ({ page, context }) => {
		await inject_test_user(context);
		const projectId = `pulse-widget-${Date.now()}`;
		await create_project(page, projectId);

		// PulseWidget should be present on the overview.
		const widget = page.getByTestId("pulse-widget");
		await expect(widget).toBeVisible();
	});

	test("pulse tab is reachable and shows the tab nav", async ({ page, context }) => {
		await inject_test_user(context);
		const projectId = `pulse-page-${Date.now()}`;
		await create_project(page, projectId);

		const response = await page.goto(`/project/${projectId}/pulse`);
		expect(response?.status()).toBeLessThan(500);

		// Tab nav rendered.
		await expect(page.getByTestId("pulse-tabs")).toBeVisible();
		await expect(page.getByTestId("pulse-tab-overview")).toBeVisible();
		await expect(page.getByTestId("pulse-tab-errors")).toBeVisible();
		await expect(page.getByTestId("pulse-tab-logs")).toBeVisible();
		await expect(page.getByTestId("pulse-tab-requests")).toBeVisible();
		await expect(page.getByTestId("pulse-tab-subscriptions")).toBeVisible();
	});

	test("unreachable state renders when pulse worker isn't configured", async ({ page, context }) => {
		await inject_test_user(context);
		const projectId = `pulse-unreachable-${Date.now()}`;
		await create_project(page, projectId);

		await page.goto(`/project/${projectId}/pulse`);
		// Because the dev worker has no pulse config, the proxy returns 503
		// and the UI shows the unreachable banner.
		await expect(page.getByTestId("pulse-unreachable")).toBeVisible();
	});

	test("each tab is deep-linkable via ?tab=", async ({ page, context }) => {
		await inject_test_user(context);
		const projectId = `pulse-tabs-${Date.now()}`;
		await create_project(page, projectId);

		for (const tab of ["errors", "logs", "requests", "subscriptions"] as const) {
			const response = await page.goto(`/project/${projectId}/pulse?tab=${tab}`);
			expect(response?.status()).toBeLessThan(500);
			const link = page.getByTestId(`pulse-tab-${tab}`);
			await expect(link).toBeVisible();
			await expect(link).toHaveClass(/active/);
		}
	});

	test("invalid tab param falls back to overview", async ({ page, context }) => {
		await inject_test_user(context);
		const projectId = `pulse-invalid-${Date.now()}`;
		await create_project(page, projectId);

		const response = await page.goto(`/project/${projectId}/pulse?tab=garbage`);
		expect(response?.status()).toBeLessThan(500);
		await expect(page.getByTestId("pulse-tab-overview")).toHaveClass(/active/);
	});
});
