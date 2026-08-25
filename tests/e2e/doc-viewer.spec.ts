import { expect, test, type BrowserContext } from "@playwright/test";
import { E2E_OUTLINE_PROJECT_ID, E2E_SESSION_ID } from "./fixtures/outline-ids";

/**
 * Task B3.1 — DocViewer: renders corpus-stored, sanitized doc content
 * inline via a sandboxed script-disabled iframe hitting its own CSP'd
 * render route. Docs are pushed directly through the live API (not the
 * static SQL seed — corpus content lives in the worker's in-memory backend,
 * which only exists inside the running dev server process; a separate
 * bun:sqlite seed script has no way to populate it).
 */
// A `client:load` island's first click can land before Solid's hydration
// attaches its event delegation (AGENTS.md's B1 outline entry) — retry once.
// DocViewer's island is also HEAVIER than most (pulls in @f0rbit/ui,
// @devpad/api, text-diff transitively), so on a cold dev server the initial
// `client:load` bundle can still be compiling well past a fixed sleep;
// `waitForLoadState("networkidle")` after `goto` is the real fix (confirmed
// by isolating this against a trivial counter-button island: a fixed wait
// was flaky, `networkidle` was not) — the click-retry stays as cheap
// insurance on top.
const clickWithRetry = async (target: import("@playwright/test").Locator, check: () => Promise<void>) => {
	await target.click();
	try {
		await check();
	} catch {
		await target.click();
		await check();
	}
};

const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async (route) => {
			await route.continue({ headers: { ...route.request().headers(), "X-Test-User": "true" } });
		},
	);
	await context.addCookies([{ name: "auth_session", value: E2E_SESSION_ID, domain: "localhost", path: "/" }]);
};

async function pushDoc(
	context: BrowserContext,
	html: string,
	opts: { document_id?: string; kind?: "plan" | "design" | "interface" } = {},
): Promise<{ id: string; head_version: string | null }> {
	const response = await context.request.post("/api/v1/docs", {
		data: {
			document_id: opts.document_id,
			project_id: E2E_OUTLINE_PROJECT_ID,
			kind: opts.kind ?? "plan",
			title: "E2E doc-viewer doc",
			html,
		},
	});
	expect(response.ok()).toBeTruthy();
	return response.json();
}

test.describe("DocViewer", () => {
	test.describe.configure({ mode: "serial" });

	test("renders safe content, neutralizes an injected-script fixture, and sets a CSP on the render response", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		const hostile = `<h1>Plan</h1><table><tbody><tr><td>cell</td></tr></tbody></table><img src="x" onerror="window.xssFired = true"><script>window.xssFired = true;</script>`;
		const doc = await pushDoc(context, hostile);

		let dialogFired = false;
		page.on("dialog", () => {
			dialogFired = true;
		});

		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
		await page.waitForLoadState("networkidle");
		const [render_response] = await Promise.all([
			page.waitForResponse((r) => r.url().includes(`/docs/${doc.id}/render`), { timeout: 10_000 }),
			clickWithRetry(page.locator(`[data-testid="doc-list-item"][data-document-id="${doc.id}"]`), () =>
				expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 3000 }),
			),
		]);
		expect(render_response.headers()["content-security-policy"]).toContain("default-src 'none'");

		const frame = page.frameLocator('[data-testid="doc-render-frame"]');
		await expect(frame.locator("h1")).toHaveText("Plan");
		await expect(frame.locator("table td")).toHaveText("cell");

		expect(dialogFired).toBe(false);
		const xss_flag = await page.evaluate(() => (window as unknown as { xssFired?: boolean }).xssFired);
		expect(xss_flag).toBeUndefined();

		const frame_html = await frame.locator("body").innerHTML();
		expect(frame_html).not.toContain("onerror");
		expect(frame_html).not.toContain("<script");
	});

	test("version picker switches rendered content between versions", async ({ page, context }) => {
		await inject_test_user(context);
		const first = await pushDoc(context, "<h1>Version one content</h1>");
		await pushDoc(context, "<h1>Version two content</h1>", { document_id: first.id });

		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
		await page.waitForLoadState("networkidle");
		await clickWithRetry(page.locator(`[data-testid="doc-list-item"][data-document-id="${first.id}"]`), () =>
			expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 3000 }),
		);

		const frame = page.frameLocator('[data-testid="doc-render-frame"]');
		await expect(frame.locator("h1")).toHaveText("Version two content");

		// `versions()` is newest-first (the lineage walk) — chip[0] is the
		// already-selected head (v2); chip[1] is the older v1.
		const chips = page.getByTestId("doc-version-chip");
		await expect(chips).toHaveCount(2);
		await chips.nth(1).click();
		await expect(frame.locator("h1")).toHaveText("Version one content");
	});
});
