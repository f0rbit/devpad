import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_COMPACT_CHILD,
	E2E_TASK_COMPACT_PARENT,
	E2E_TASK_PHASE,
} from "./fixtures/outline-ids";

/**
 * Task B1.2 — outline rows: add-child, rename, advance, reparent, compaction.
 *
 * Each scenario (other than compaction) creates its OWN throwaway task via
 * quick-add rather than mutating the shared phase/child-1/child-2/leaf rows —
 * those rows are read by `outline-smoke.spec.ts` and `outline-zoom.spec.ts`,
 * which may run in a different worker concurrently. The compaction scenario
 * uses a dedicated fixture pair (`compact-parent`/`compact-child`) reserved
 * for exactly this purpose.
 *
 * The `X-Test-User` header only fakes auth for Astro's SSR — every mutation
 * here goes through `getBrowserClient()` (real cookie-authed fetches to the
 * worker), so the browser context also needs a real `auth_session` cookie
 * validating against the seeded `session` row.
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
 * delegation (a generic Astro-islands race, not app logic), so the "add
 * child" button's very first click is occasionally a no-op. Retrying once
 * the input fails to appear promptly is the standard resilience pattern for
 * this rather than an arbitrary fixed settle-wait.
 */
const quickAdd = async (page: Page, title: string) => {
	const placeholder = page.getByPlaceholder("New task title…");
	const addButton = page.getByRole("button", { name: /add child/i });
	await addButton.click();
	let opened = false;
	for (let attempt = 0; attempt < 3 && !opened; attempt++) {
		opened = await placeholder
			.waitFor({ state: "visible", timeout: 10000 })
			.then(() => true)
			.catch(() => false);
		if (!opened) await addButton.click();
	}
	await placeholder.fill(title);
	await placeholder.press("Enter");
	await expect(page.locator(".outline-title", { hasText: title })).toBeVisible();
	return page.locator(".outline-row", { has: page.locator(".outline-title", { hasText: title }) });
};

test.describe("outline row interactions", () => {
	// This file is the suite's heaviest on the dev server (every test is a
	// real client-side mutation through the worker, one drives a bubble
	// cascade with its own staggered timing) — serial keeps it from
	// contending with itself under the repo's global `fullyParallel: true`
	// when run alongside the other outline specs.
	test.describe.configure({ mode: "serial" });

	test("add-child persists across reload", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const title = `E2E added ${Date.now()}`;
		await quickAdd(page, title);

		await page.reload();
		await expect(page.locator(".outline-title", { hasText: title })).toBeVisible();
	});

	test("inline rename persists across reload", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const original = `E2E rename-me ${Date.now()}`;
		const row = await quickAdd(page, original);
		// Capture the row's stable `data-task-id` up front — `row` itself is
		// scoped via `has: .outline-title[hasText]`, and that title text is
		// exactly what rename mode swaps out for the input, so re-querying
		// through `row` after renaming starts would match nothing.
		const taskId = await row.getAttribute("data-task-id");
		const stableRow = page.locator(`[data-task-id="${taskId}"]`);
		const input = stableRow.locator(".outline-rename-input");
		const renamed = `E2E renamed ${Date.now()}`;

		// Keyboard trigger (select + Enter) rather than dblclick: native
		// double-click detection requires the browser to see both clicks land
		// on the identical element within its timing window, which is flaky
		// for a row created moments earlier in the same test — select+Enter
		// exercises the same `store.startRename` path deterministically and
		// matches the outline's keyboard-first design anyway.
		await stableRow.locator(".outline-title").click();
		await expect(stableRow).toHaveClass(/outline-row-selected/);
		await page.locator(".outline-container").press("Enter");
		await input.waitFor({ state: "visible", timeout: 10000 });
		await input.fill(renamed);
		await input.press("Enter");
		await expect(page.locator(".outline-title", { hasText: renamed })).toBeVisible();

		await page.reload();
		await expect(page.locator(".outline-title", { hasText: renamed })).toBeVisible();
		await expect(page.locator(".outline-title", { hasText: original })).toHaveCount(0);
	});

	test("advancing status persists across reload", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const title = `E2E advance ${Date.now()}`;
		const row = await quickAdd(page, title);

		await expect(row.locator(".outline-dot")).not.toHaveClass(/outline-dot-doing/);
		await row.locator(".outline-bullet").click();
		await expect(row.locator(".outline-dot")).toHaveClass(/outline-dot-doing/);

		await page.reload();
		const reloadedRow = page.locator(".outline-row", { has: page.locator(".outline-title", { hasText: title }) });
		await expect(reloadedRow.locator(".outline-dot")).toHaveClass(/outline-dot-doing/);
	});

	test("shift-tab promotes a nested task to the project root and persists", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work?node=${E2E_TASK_PHASE}`);

		const title = `E2E reparent ${Date.now()}`;
		await quickAdd(page, title); // created under the zoomed phase

		await page.locator(".outline-title", { hasText: title }).click();
		await page.locator(".outline-container").press("Shift+Tab");

		// promoted out of the phase — back to the project root, no longer under this zoom.
		await expect(page.locator(".outline-title", { hasText: title })).toHaveCount(0);

		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);
		await expect(page.locator(".outline-title", { hasText: title })).toBeVisible();
	});

	test("Tab is never hijacked before a row is actively selected — keyboard focus travels normally", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const container = page.locator(".outline-container");
		await expect(container).toBeFocused();

		// no j/k selection yet — Tab must NOT be preventDefault-ed into a reparent;
		// default browser focus traversal moves off the container onto the first
		// interactive descendant (a row's own bullet/title button).
		await page.keyboard.press("Tab");
		await expect(container).not.toBeFocused();
		const focused = await page.evaluate(() => document.activeElement?.closest(".outline-container") != null);
		expect(focused).toBe(true); // landed on something INSIDE the outline, not hijacked out of it entirely either
	});

	test("alt-↑ moves a sibling up (rank_between) and persists across reload", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		const titleA = `E2E reorder A ${Date.now()}`;
		const titleB = `E2E reorder B ${Date.now()}`;
		await quickAdd(page, titleA);
		const rowB = await quickAdd(page, titleB); // appended after A — B starts below A

		const orderOf = async () => {
			const titles = await page.locator(".outline-title").allTextContents();
			return { a: titles.indexOf(titleA), b: titles.indexOf(titleB) };
		};

		const before = await orderOf();
		expect(before.a).toBeGreaterThanOrEqual(0);
		expect(before.b).toBeGreaterThan(before.a);

		await rowB.locator(".outline-title").click();
		await expect(rowB).toHaveClass(/outline-row-selected/);
		await page.locator(".outline-container").press("Alt+ArrowUp");

		await expect
			.poll(async () => {
				const order = await orderOf();
				return order.b - order.a;
			})
			.toBeLessThan(0);

		await page.reload();
		const after_reload = await orderOf();
		expect(after_reload.b).toBeLessThan(after_reload.a);
	});

	test("a fully-done auto_children subtree compacts into a summary row", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/work`);

		await expect(page.locator(`[data-task-id="${E2E_TASK_COMPACT_CHILD}"]`)).toBeVisible();

		// IN_PROGRESS -> COMPLETED: one click. The only child completing bubbles
		// the auto_children parent to COMPLETED too, which triggers compaction.
		await page.locator(`[data-task-id="${E2E_TASK_COMPACT_CHILD}"] .outline-bullet`).click();

		const parentRow = page.locator(`[data-task-id="${E2E_TASK_COMPACT_PARENT}"]`);
		// The bubble-completion round trip (done() -> 240ms-staggered ancestor
		// update) adds real latency on top of the click's own request — give it
		// more room than the default 5s under a cold/contended dev server.
		await expect(parentRow).toHaveClass(/outline-row-done/, { timeout: 15000 });
		await expect(page.locator(".outline-compact-row")).toContainText("compacted");
		await expect(page.locator(`[data-task-id="${E2E_TASK_COMPACT_CHILD}"]`)).toHaveCount(0);

		// expand affordance restores the real child row.
		await page.locator(".outline-compact-row").click();
		await expect(page.locator(`[data-task-id="${E2E_TASK_COMPACT_CHILD}"]`)).toBeVisible();
	});
});
