import { expect, test, type BrowserContext, type Locator } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_CHILD_1,
	E2E_TASK_CHILD_2,
	E2E_TASK_LEAF,
	E2E_TASK_PHASE,
} from "./fixtures/outline-ids";

/**
 * Task B1.3 — zoom-into-node, breadcrumbs, connections rail.
 *
 * The `X-Test-User` header only fakes auth for Astro's OWN server-side
 * render (`Astro.locals.user`, via the middleware) — it does nothing for
 * client-side `getBrowserClient()` calls (zoom navigation, the rail's
 * `near()` fetch), which hit the worker directly with real cookies. Those
 * need an actual `auth_session` cookie validating against the seeded
 * `session` row, same id the SSR path forwards server-side.
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

/**
 * The outline is a `client:load` Astro island — on a fresh navigation the
 * first click can land before Solid's hydration has attached its event
 * delegation (a generic Astro-islands race, not app logic). Retrying the
 * click once the expected effect fails to appear promptly is the standard
 * resilience pattern for this, matching `outline-interactions.spec.ts`'s
 * `quickAdd` helper.
 */
const clickWithRetry = async (target: Locator, check: () => Promise<void>) => {
	await target.click();
	try {
		await check();
	} catch {
		await target.click();
		await check();
	}
};

test.describe("zoom + breadcrumbs", () => {
	test("direct load of ?node= renders that subtree, not the project root", async ({ page, context }) => {
		await inject_test_user(context);
		const response = await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?node=${E2E_TASK_PHASE}&view=list`);
		expect(response?.status()).toBeLessThan(400);

		await expect(page.getByTestId("outline-zoom-title")).toHaveText("Ripple UI");
		await expect(page.locator(`[data-task-id="${E2E_TASK_CHILD_1}"]`)).toBeVisible();
		await expect(page.locator(`[data-task-id="${E2E_TASK_CHILD_2}"]`)).toBeVisible();
		// the standalone leaf is a sibling of the phase, not a descendant — absent once zoomed in.
		await expect(page.locator(`[data-task-id="${E2E_TASK_LEAF}"]`)).toHaveCount(0);
	});

	test("clicking a parent row's ring zooms in and updates the URL + crumbs", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		await clickWithRetry(page.locator(`[data-task-id="${E2E_TASK_PHASE}"] .outline-bullet`), () =>
			expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_PHASE}`), { timeout: 3000 }),
		);
		await expect(page.getByTestId("outline-zoom-title")).toHaveText("Ripple UI");
		await expect(page.getByTestId("outline-crumbs")).toContainText("Ripple UI");
	});

	test("a crumb click zooms back out to the project root", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?node=${E2E_TASK_PHASE}&view=list`);

		await clickWithRetry(page.getByTestId("outline-crumbs").getByRole("button", { name: "e2e-outline-project" }), () =>
			expect(page).not.toHaveURL(/node=/, { timeout: 3000 }),
		);
		await expect(page.locator(`[data-task-id="${E2E_TASK_LEAF}"]`)).toBeVisible();
	});

	test("browser Back/Forward stays in sync with the zoomed view", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		await clickWithRetry(page.locator(`[data-task-id="${E2E_TASK_PHASE}"] .outline-bullet`), () =>
			expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_PHASE}`), { timeout: 3000 }),
		);
		await expect(page.getByTestId("outline-zoom-title")).toHaveText("Ripple UI");

		await page.goBack();
		await expect(page).not.toHaveURL(/node=/, { timeout: 3000 });
		await expect(page.locator(`[data-task-id="${E2E_TASK_LEAF}"]`)).toBeVisible();

		await page.goForward();
		await expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_PHASE}`), { timeout: 3000 });
		await expect(page.getByTestId("outline-zoom-title")).toHaveText("Ripple UI");
	});
});

test.describe("connections rail", () => {
	test("selecting the blocked child lists the leaf under 'blocked by'", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		const rail = page.getByTestId("outline-rail");
		await clickWithRetry(page.locator(`[data-task-id="${E2E_TASK_CHILD_2}"]`), () =>
			expect(rail).toContainText("Wire zoom breadcrumbs", { timeout: 3000 }),
		);
		await expect(rail).toContainText("blocked by");
		await expect(rail).toContainText("Standalone leaf task");
	});

	test("clicking a rail item travels in-place — zooms the outline, never navigates away", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		const rail = page.getByTestId("outline-rail");
		await clickWithRetry(page.locator(`[data-task-id="${E2E_TASK_CHILD_2}"]`), () =>
			expect(rail).toContainText("Standalone leaf task", { timeout: 3000 }),
		);

		await clickWithRetry(rail.getByRole("button", { name: "Standalone leaf task" }), () =>
			expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_LEAF}`), { timeout: 3000 }),
		);
		// still on the same page (in-place travel) — only the ?node= param + zoom header changed.
		await expect(page).toHaveURL(new RegExp(`/project/${E2E_OUTLINE_PROJECT_ID}\\?view=list`));
		await expect(page.getByTestId("outline-zoom-title")).toHaveText("Standalone leaf task");
	});
});
