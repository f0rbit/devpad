import { expect, test, type BrowserContext } from "@playwright/test";
import { E2E_HOOK_ID, E2E_OUTLINE_PROJECT_ID, E2E_SESSION_ID } from "./fixtures/outline-ids";

/**
 * Task B3.4 — settings panels: per-project scoped API keys (issue + revoke,
 * key shown exactly once) and the hook deliveries read-only list with the
 * `failed_permanent` DLQ surfaced prominently + an enable/disable toggle.
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

test.describe("Settings — v2.4 panels", () => {
	test.describe.configure({ mode: "serial" });

	test("scoped key create/revoke round-trips; the raw key never persists after dismissal", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/settings`);
		await page.waitForLoadState("networkidle");

		const nameInput = page.getByTestId("scoped-keys").locator("input").first();
		await nameInput.fill("e2e-test-key");
		await page.getByTestId("scoped-key-create").click();

		const reveal = page.getByTestId("scoped-key-reveal");
		await expect(reveal).toBeVisible();
		const rawKey = await page.getByTestId("scoped-key-raw").textContent();
		expect(rawKey).toMatch(/^devpad_/);

		const item = page.getByTestId("scoped-key-item").filter({ hasText: "e2e-test-key" });
		await expect(item).toBeVisible();

		await page.getByTestId("scoped-key-reveal-done").click();
		await expect(reveal).toHaveCount(0);
		// The dismissed key must never reappear anywhere in the DOM afterward.
		await expect(page.locator(`text=${rawKey}`)).toHaveCount(0);

		await item.getByTestId("scoped-key-revoke").click();
		await expect(page.getByTestId("scoped-key-item").filter({ hasText: "e2e-test-key" })).toHaveCount(0);
	});

	test("seeded failed_permanent delivery is visible by default, with error detail; toggle flips enabled state", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/settings`);
		await page.waitForLoadState("networkidle");

		const group = page.locator(`[data-testid="hook-group"][data-hook-id="${E2E_HOOK_ID}"]`);
		await expect(group).toBeVisible();

		const dlqItem = group.locator(`[data-testid="hook-delivery-item"][data-status="failed_permanent"]`);
		await expect(dlqItem).toBeVisible();
		await expect(dlqItem).toContainText("ECONNREFUSED");

		await expect(group.getByTestId("hook-toggle-enabled")).toHaveText("disable");
		await group.getByTestId("hook-toggle-enabled").click();
		await expect(group.getByTestId("hook-toggle-enabled")).toHaveText("enable");
		// Restore for idempotent re-runs.
		await group.getByTestId("hook-toggle-enabled").click();
		await expect(group.getByTestId("hook-toggle-enabled")).toHaveText("disable");
	});
});
