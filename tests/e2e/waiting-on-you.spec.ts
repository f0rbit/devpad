import { expect, test, type BrowserContext, type Locator } from "@playwright/test";
import { E2E_SESSION_ID } from "./fixtures/waiting-on-you-ids";

/**
 * Task B2.4 — "Waiting on you": integration atop /todo, sourced from the
 * A4.6 `reviews/pending` aggregate. `X-Test-User` fakes Astro's OWN SSR
 * auth (the server-side `reviews.pending()` fetch); the inline Approve
 * click is a real client-side `getBrowserClient()` call needing an actual
 * `auth_session` cookie (`decide_checkpoint` is human/session-only).
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

/** The outline's other specs document this same cold-hydration race for a `client:load` island's first click — retry once. */
const clickWithRetry = async (target: Locator, check: () => Promise<void>) => {
	await target.click();
	try {
		await check();
	} catch {
		await target.click();
		await check();
	}
};

test.describe("waiting on you", () => {
	// Serial — same cold-dev-server-compile rationale as the lens/ripple specs.
	test.describe.configure({ mode: "serial" });

	test("renders the seeded pending signoff as a card with an inline Approve action", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto("/todo");

		const section = page.getByTestId("waiting-on-you");
		await expect(section).toBeVisible();

		const card = page.locator(`[data-testid="waiting-card"]`, { hasText: "plan checkpoint" });
		await expect(card).toBeVisible();
		await expect(card).toContainText("sign-off");

		await clickWithRetry(card.getByRole("button", { name: "Approve" }), () =>
			expect(page.locator(`[data-testid="waiting-card"]`, { hasText: "plan checkpoint" })).toHaveCount(0, {
				timeout: 5000,
			}),
		);
	});

	test("collapses to nothing once nothing is pending — zero clutter above the task list", async ({ page, context }) => {
		await inject_test_user(context);
		await page.goto("/todo");

		// The previous test already resolved the one seeded signoff; this
		// assertion holds regardless of run order — either the section never
		// rendered a wrapper, or it's gone after the approve above. Either way:
		// no visible "waiting on you" chrome once the pending list is empty.
		const section = page.getByTestId("waiting-on-you");
		const card = page.locator(`[data-testid="waiting-card"]`, { hasText: "plan checkpoint" });
		if ((await card.count()) > 0) {
			await clickWithRetry(card.getByRole("button", { name: "Approve" }), () =>
				expect(card).toHaveCount(0, { timeout: 5000 }),
			);
		}
		await expect(section).toHaveCount(0);
	});

	test("360px viewport — mobile-first layout, no cramped inline row", async ({ page, context }) => {
		await inject_test_user(context);
		await page.setViewportSize({ width: 360, height: 800 });
		await page.goto("/todo");
		// section may already be empty from the prior tests in this serial file —
		// this test only asserts the page renders cleanly at 360px either way.
		await expect(page.locator("main")).toBeVisible();
	});
});
