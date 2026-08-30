import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_CHILD_1,
	E2E_TASK_RIPPLE_GRANDPARENT,
	E2E_TASK_RIPPLE_LEAF,
	E2E_TASK_RIPPLE_REDUCED_LEAF,
	E2E_TASK_RIPPLE_REDUCED_PARENT,
} from "./fixtures/outline-ids";

/**
 * Task B2.3 — ripple choreography (replays the API's real `bubbled` chain),
 * stale badge + policy-only reopen. Each scenario below uses its OWN
 * dedicated fixture pair/chain (never `E2E_TASK_COMPACT_PARENT`, shared
 * with outline-interactions.spec.ts) so completions here can't race a
 * different spec file under full parallelism.
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

/** The outline is a `client:load` island — retry the first interaction on a fresh page, matching the other outline specs. */
const clickWithRetry = async (target: ReturnType<Page["locator"]>, check: () => Promise<void>) => {
	await target.click();
	try {
		await check();
	} catch {
		await target.click();
		await check();
	}
};

test.describe("ripple choreography + stale + reopen", () => {
	// Serial — see lens-graph.spec.ts's comment: cold-boot compile contention
	// under parallel first-navigations, not mutation contention.
	test.describe.configure({ mode: "serial" });

	test("completing the leaf bubbles both ancestors, each gets a reopen affordance", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		const leafBullet = page.locator(`[data-task-id="${E2E_TASK_RIPPLE_LEAF}"] .outline-bullet`);
		const grandparentRow = page.locator(`[data-task-id="${E2E_TASK_RIPPLE_GRANDPARENT}"]`);

		await clickWithRetry(leafBullet, () => expect(grandparentRow).toHaveClass(/outline-row-done/, { timeout: 15000 }));
		await expect(grandparentRow).toHaveClass(/outline-row-done/, { timeout: 15000 });

		// Both ancestors are policy-completed — but the parent's own row is now
		// hidden behind the grandparent's auto-compaction (a fully-done
		// auto_children subtree compacts its CHILDREN, not itself). The
		// grandparent is root-level with nothing further up to compact IT away,
		// so its own reopen affordance is always reachable without expanding.
		await expect(grandparentRow.locator(".outline-reopen")).toBeVisible();

		await grandparentRow.locator(".outline-reopen").click();
		await expect(grandparentRow).not.toHaveClass(/outline-row-done/, { timeout: 5000 });
		await expect(grandparentRow.locator(".outline-reopen")).toHaveCount(0);
	});

	test("reopen is absent on a directly (non-policy) completed task", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		const row = page.locator(`[data-task-id="${E2E_TASK_CHILD_1}"]`);
		await clickWithRetry(row.locator(".outline-bullet"), () =>
			expect(row).toHaveClass(/outline-row-done/, { timeout: 10000 }),
		);
		await expect(row.locator(".outline-reopen")).toHaveCount(0);
	});

	test("prefers-reduced-motion bypasses the stagger — instant update + a summary toast", async ({ page, context }) => {
		await inject_test_user(context);
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?view=list`);

		const leafBullet = page.locator(`[data-task-id="${E2E_TASK_RIPPLE_REDUCED_LEAF}"] .outline-bullet`);
		const parentRow = page.locator(`[data-task-id="${E2E_TASK_RIPPLE_REDUCED_PARENT}"]`);

		await clickWithRetry(leafBullet, () => expect(parentRow).toHaveClass(/outline-row-done/, { timeout: 3000 }));
		await expect(page.locator(".outline-toast", { hasText: /completed 1 ancestor/ })).toBeVisible();

		// the ripple pulse animation itself never fires under reduced motion.
		await expect(page.locator(".outline-ripple")).toHaveCount(0);
	});
});
