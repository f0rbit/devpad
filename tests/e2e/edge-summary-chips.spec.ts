import { expect, test, type BrowserContext } from "@playwright/test";
import { E2E_OUTLINE_PROJECT_ID, E2E_SESSION_ID, E2E_TASK_CHILD_2, E2E_TASK_LEAF } from "./fixtures/outline-ids";

/**
 * Task B2 (edge-summary chips) — `edge_summary_for` is the single source of
 * truth for the row's ⛓/ready/⚡/stale chips (see
 * `packages/core/src/services/graph/edge-summary.ts`); this asserts the
 * outline row renders exactly what that wire field says, not a client-side
 * re-derivation. `E2E_TASK_LEAF` (unblocked, childless, UNSTARTED) and
 * `E2E_TASK_CHILD_2` (blocked by the leaf) are read-only fixtures shared with
 * `lens-graph.spec.ts` — this spec never mutates either row.
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

test.describe("edge-summary chips", () => {
	test("an unblocked leaf shows the ready chip, never the blocked chip", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const leafRow = page.locator(`[data-task-id="${E2E_TASK_LEAF}"]`);
		await expect(leafRow.locator(".outline-chip-ready")).toBeVisible();
		await expect(leafRow.locator(".outline-chip-blocked")).toHaveCount(0);
	});

	test("a task blocked by an open blocker shows the blocked chip, never the ready chip", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const blockedRow = page.locator(`[data-task-id="${E2E_TASK_CHILD_2}"]`);
		await expect(blockedRow.locator(".outline-chip-blocked")).toContainText("1");
		await expect(blockedRow.locator(".outline-chip-ready")).toHaveCount(0);
	});
});
