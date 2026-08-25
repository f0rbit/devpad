import { expect, test, type BrowserContext } from "@playwright/test";
import { E2E_OUTLINE_PROJECT_ID, E2E_SESSION_ID, E2E_TASK_CHILD_2, E2E_TASK_LEAF } from "./fixtures/outline-ids";

/**
 * Task B2.1 — graph lens: an ephemeral, Esc-dismissable overlay over the
 * task-link neighborhood (`tasks.near`), NEVER a route. `E2E_TASK_CHILD_2`
 * is blocked by `E2E_TASK_LEAF` in the seeded fixture — a real edge to
 * render, no extra seeding needed.
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

/** Same cold-hydration retry pattern as the outline's other specs — the first interaction on a fresh page can land before Solid attaches. */
const pressWithRetry = async (page: import("@playwright/test").Page, key: string, check: () => Promise<void>) => {
	await page.keyboard.press(key);
	try {
		await check();
	} catch {
		await page.keyboard.press(key);
		await check();
	}
};

const selectChild2 = async (page: import("@playwright/test").Page) => {
	const row = page.locator(`[data-task-id="${E2E_TASK_CHILD_2}"]`);
	await row.click();
	try {
		await expect(row).toHaveClass(/outline-row-selected/, { timeout: 3000 });
	} catch {
		await row.click();
		await expect(row).toHaveClass(/outline-row-selected/, { timeout: 3000 });
	}
};

test.describe("graph lens", () => {
	// Serial, matching outline-interactions.spec.ts's own rationale: every test
	// here is the FIRST navigation of a fresh browser context against the
	// shared dev server — under full parallelism, several simultaneous
	// first-navigations can outrun a cold Vite compile badly enough that the
	// documented single-retry cold-boot-hydration allowance isn't enough.
	test.describe.configure({ mode: "serial" });

	test("g opens the seeded neighborhood, Esc closes it, no route change", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);
		const startUrl = page.url();

		await selectChild2(page);

		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "g", () => expect(lens).toBeVisible({ timeout: 5000 }));

		await expect(page.locator(`[data-testid="lens-graph-node"][data-task-id="${E2E_TASK_CHILD_2}"]`)).toBeVisible();
		await expect(page.locator(`[data-testid="lens-graph-node"][data-task-id="${E2E_TASK_LEAF}"]`)).toBeVisible();
		await expect(page.locator(".lens-edge-blocks")).toHaveCount(1);

		// never a route — URL is unchanged while the lens is open.
		expect(page.url()).toBe(startUrl);

		await page.keyboard.press("Escape");
		await expect(lens).toHaveCount(0);
		expect(page.url()).toBe(startUrl);
	});

	test("close button dismisses the lens the same as Esc", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		await selectChild2(page);
		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "g", () => expect(lens).toBeVisible({ timeout: 5000 }));

		await page.locator(".lens-close").click();
		await expect(lens).toHaveCount(0, { timeout: 3000 });
	});

	test("depth toggle 1 hides what depth 2 shows", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		await selectChild2(page);
		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "g", () => expect(lens).toBeVisible({ timeout: 5000 }));

		// depth 2 (default) already includes the leaf — clicking "1" is still a
		// same-node neighborhood here (leaf is one hop away either way), so
		// assert the toggle buttons themselves reflect the active depth instead.
		const depth1 = page.locator(".lens-depth-btn", { hasText: "1" });
		const depth2 = page.locator(".lens-depth-btn", { hasText: "2" });
		await expect(depth2).toHaveClass(/lens-depth-btn-active/);
		await depth1.click();
		await expect(depth1).toHaveClass(/lens-depth-btn-active/);
		await expect(page.locator(`[data-testid="lens-graph-node"][data-task-id="${E2E_TASK_LEAF}"]`)).toBeVisible();

		await page.keyboard.press("Escape");
	});

	test("double-click a node zooms the outline there and closes the lens", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		await selectChild2(page);
		const lens = page.getByTestId("lens-overlay");
		await pressWithRetry(page, "g", () => expect(lens).toBeVisible({ timeout: 5000 }));

		// Two deliberate clicks rather than `.dblclick()` — the lens defers its
		// single-click refocus for exactly this window (see graph-lens.tsx's
		// `onNodeClick`), so this exercises the real double-click path
		// deterministically without depending on the browser's native
		// double-click timing against a synthetic pointer sequence.
		const leafNode = page.locator(`[data-testid="lens-graph-node"][data-task-id="${E2E_TASK_LEAF}"]`);
		await leafNode.click();
		await leafNode.click();

		await expect(lens).toHaveCount(0);
		await expect(page).toHaveURL(new RegExp(`node=${E2E_TASK_LEAF}`));
	});
});
