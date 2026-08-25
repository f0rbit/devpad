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

	test("preserves a real .plans-style doc's class-selector CSS and TOC fragment anchors post-sanitize", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		const plansStyleDoc = [
			`<style>.hl { color: rgb(255, 0, 0); }</style>`,
			`<div class="toc">`,
			`<a href="#overview">Overview</a>`,
			`<a href="#phase-1">Phase 1</a>`,
			`<a href="#phase-2">Phase 2</a>`,
			`</div>`,
			`<h1 id="overview" class="hl">Overview</h1>`,
			`<h2 id="phase-1">Phase 1</h2>`,
			`<h2 id="phase-2">Phase 2</h2>`,
			`<h3 id="phase-2-tasks">Phase 2 tasks</h3>`,
			`<h3 id="phase-2-verification">Phase 2 verification</h3>`,
		].join("\n");
		const doc = await pushDoc(context, plansStyleDoc, { kind: "design" });

		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
		await page.waitForLoadState("networkidle");
		await clickWithRetry(page.locator(`[data-testid="doc-list-item"][data-document-id="${doc.id}"]`), () =>
			expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 3000 }),
		);

		const frame = page.frameLocator('[data-testid="doc-render-frame"]');
		// class-selector CSS from the doc's own <style> block actually applies —
		// not just present in the markup, but matched and painted.
		await expect(frame.locator("h1")).toHaveCSS("color", "rgb(255, 0, 0)");

		// heading ids are clobber-prefixed (hast-util-sanitize's DOM-clobbering
		// protection is unchanged)...
		await expect(frame.locator("h1")).toHaveAttribute("id", "user-content-overview");
		// ...and the TOC's fragment hrefs are rewritten to match, so clicking a
		// TOC link still resolves to its heading post-sanitize.
		const overviewLink = frame.locator('div.toc a[href="#user-content-overview"]');
		await expect(overviewLink).toHaveCount(1);
		const phase2Link = frame.locator('div.toc a[href="#user-content-phase-2"]');
		await expect(phase2Link).toHaveCount(1);
		await expect(frame.locator("#user-content-phase-2")).toHaveText("Phase 2");
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

	test("adjacent-version diff strips marker comments and reads as text, not a base64 blob (fast-follow #3)", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		const v1 = "<h1>Plan</h1><p>The quick brown fox jumps over the lazy dog.</p>";
		const first = await pushDoc(context, v1, { kind: "plan" });

		// Simulates what the annotation engine mints on a real select→annotate
		// (see annotations.spec.ts) — a marker comment pair bracketing "brown
		// fox", plus a genuine prose edit, in the SAME version bump.
		const marker = {
			id: "thread_e2e-diff-1",
			anchor: { quote: "brown fox", prefix: "", suffix: "", start: 0, end: 0 },
			status: "open",
			blocking: false,
			entries: [{ author: "tester", channel: "user", body: "diff legibility check", at: new Date().toISOString() }],
		};
		const payload = Buffer.from(JSON.stringify(marker), "utf-8").toString("base64");
		const v2 = `<h1>Plan</h1><p>The quick <!-- devpad:thread:begin ${marker.id} ${payload} -->brown fox<!-- devpad:thread:end ${marker.id} --> jumps over the lazy dog. A new line of prose.</p>`;
		await pushDoc(context, v2, { document_id: first.id, kind: "plan" });

		await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
		await page.waitForLoadState("networkidle");
		await clickWithRetry(page.locator(`[data-testid="doc-list-item"][data-document-id="${first.id}"]`), () =>
			expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 3000 }),
		);

		await expect(page.getByTestId("doc-version-chip")).toHaveCount(2);
		await page.getByTestId("doc-version-diff-link").first().click();

		const panel = page.getByTestId("doc-diff-panel");
		await expect(panel).toBeVisible();
		await expect(panel).not.toContainText("Loading diff…");
		const panelText = await panel.innerText();
		expect(panelText).not.toContain("devpad:thread");
		expect(panelText).not.toContain("<!--");
		expect(panelText).not.toContain("<p>");
		expect(panelText).toContain("brown fox");
		expect(panelText).toContain("A new line of prose.");
	});
});
