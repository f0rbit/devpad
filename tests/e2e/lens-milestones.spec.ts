import { expect, test, type BrowserContext } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_MILESTONE,
	E2E_TASK_MILESTONE_CHILD,
} from "./fixtures/outline-ids";

/**
 * Task B2.2 — milestone lens: Dagster-style collapsed phase cards with real
 * rollup badges, sourced from `milestones.getByProject` + `tasks.tree`
 * (the same rollup/edge_summary fields the outline's own rows use).
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

const pressWithRetry = async (page: import("@playwright/test").Page, key: string, check: () => Promise<void>) => {
	await page.keyboard.press(key);
	try {
		await check();
	} catch {
		await page.keyboard.press(key);
		await check();
	}
};

test.describe("milestone lens", () => {
	test("m opens milestone cards with seeded rollup counts, Esc dismisses", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);
		const startUrl = page.url();

		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "m", () => expect(lens).toBeVisible({ timeout: 5000 }));

		const card = page.locator(`[data-testid="lens-milestone-card"][data-task-id="${E2E_TASK_MILESTONE}"]`);
		await expect(card).toBeVisible();
		await expect(card).toContainText("Ripple v1");
		await expect(card).toContainText("0/1 done");

		expect(page.url()).toBe(startUrl);
		await page.keyboard.press("Escape");
		await expect(lens).toHaveCount(0);
	});

	test("expand reveals the goal/task chain; clicking a child zooms the outline there", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "m", () => expect(lens).toBeVisible({ timeout: 5000 }));

		const card = page.locator(`[data-testid="lens-milestone-card"][data-task-id="${E2E_TASK_MILESTONE}"]`);
		await card.locator(".lens-milestone-expand").click();
		const childButton = card.locator(".lens-milestone-child", { hasText: "Ship the ripple lens" });
		await expect(childButton).toBeVisible();

		await childButton.click();
		await expect(lens).toHaveCount(0);
		await expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_MILESTONE_CHILD}`));
	});

	test("clicking a milestone card's ring zooms the outline to the milestone", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "m", () => expect(lens).toBeVisible({ timeout: 5000 }));

		await page
			.locator(`[data-testid="lens-milestone-card"][data-task-id="${E2E_TASK_MILESTONE}"] .lens-milestone-head`)
			.click();
		await expect(lens).toHaveCount(0);
		await expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_MILESTONE}`));
		await expect(page.getByTestId("outline-zoom-title")).toHaveText("Ripple v1");
	});
});
