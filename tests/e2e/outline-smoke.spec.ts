import { expect, test, type BrowserContext } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_TASK_CHILD_1,
	E2E_TASK_CHILD_2,
	E2E_TASK_LEAF,
	E2E_TASK_PHASE,
} from "./fixtures/outline-ids";

/**
 * Task B1.1 — work page server plumbing + old-URL redirects.
 *
 * Local scope: fake auth via the `X-Test-User` header (see
 * `apps/main/src/middleware.ts`), matching the pipelines suite's pattern.
 */
const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async (route) => {
			await route.continue({ headers: { ...route.request().headers(), "X-Test-User": "true" } });
		},
	);
};

test.describe("work page — server plumbing", () => {
	test("renders the seeded project tree (phase + both children + standalone leaf)", async ({ page, context }) => {
		await inject_test_user(context);

		const response = await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);
		expect(response?.status()).toBeLessThan(400);

		await expect(page.getByTestId("outline")).toBeVisible();
		await expect(page.locator(`[data-task-id="${E2E_TASK_PHASE}"]`)).toContainText("Ripple UI");
		await expect(page.locator(`[data-task-id="${E2E_TASK_CHILD_1}"]`)).toContainText("Build outline rows");
		await expect(page.locator(`[data-task-id="${E2E_TASK_CHILD_2}"]`)).toContainText("Wire zoom breadcrumbs");
		await expect(page.locator(`[data-task-id="${E2E_TASK_LEAF}"]`)).toContainText("Standalone leaf task");
	});

	test("the phase's HIGH-priority claimed child shows its chips", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		const child = page.locator(`[data-task-id="${E2E_TASK_CHILD_1}"]`);
		await expect(child).toContainText("HIGH");
		await expect(child).toContainText("claimed");
		await expect(child).toContainText("agent-1");
	});
});

test.describe("old task/goal/work/overview/canvas URLs 301 to the canvas home", () => {
	test("/tasks redirects to the canvas home's list view, preserving query params", async ({ request }) => {
		const response = await request.get(`/project/${E2E_OUTLINE_PROJECT_ID}/tasks?foo=bar`, {
			maxRedirects: 0,
			headers: { "X-Test-User": "true" },
		});
		expect(response.status()).toBe(301);
		expect(response.headers().location).toBe(`/project/${E2E_OUTLINE_PROJECT_ID}?foo=bar&view=list`);
	});

	test("/goals redirects to the canvas home's list view", async ({ request }) => {
		const response = await request.get(`/project/${E2E_OUTLINE_PROJECT_ID}/goals`, {
			maxRedirects: 0,
			headers: { "X-Test-User": "true" },
		});
		expect(response.status()).toBe(301);
		expect(response.headers().location).toBe(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);
	});

	test("/work redirects to the canvas home's list view, preserving query params", async ({ request }) => {
		const response = await request.get(`/project/${E2E_OUTLINE_PROJECT_ID}/work?node=${E2E_TASK_PHASE}`, {
			maxRedirects: 0,
			headers: { "X-Test-User": "true" },
		});
		expect(response.status()).toBe(301);
		expect(response.headers().location).toBe(`/project/${E2E_OUTLINE_PROJECT_ID}?node=${E2E_TASK_PHASE}&view=list`);
	});

	test("/overview redirects to the canvas home", async ({ request }) => {
		const response = await request.get(`/project/${E2E_OUTLINE_PROJECT_ID}/overview`, {
			maxRedirects: 0,
			headers: { "X-Test-User": "true" },
		});
		expect(response.status()).toBe(301);
		expect(response.headers().location).toBe(`/project/${E2E_OUTLINE_PROJECT_ID}`);
	});

	test("/canvas redirects to the canvas home", async ({ request }) => {
		const response = await request.get(`/project/${E2E_OUTLINE_PROJECT_ID}/canvas`, {
			maxRedirects: 0,
			headers: { "X-Test-User": "true" },
		});
		expect(response.status()).toBe(301);
		expect(response.headers().location).toBe(`/project/${E2E_OUTLINE_PROJECT_ID}`);
	});

	test("/specification redirects to /docs", async ({ request }) => {
		const response = await request.get(`/project/${E2E_OUTLINE_PROJECT_ID}/specification`, {
			maxRedirects: 0,
			headers: { "X-Test-User": "true" },
		});
		expect(response.status()).toBe(301);
		expect(response.headers().location).toBe(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
	});
});
