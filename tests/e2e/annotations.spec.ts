import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_OUTLINE_PROJECT_ID, E2E_SESSION_ID } from "./fixtures/outline-ids";

/**
 * Task B3.2 — AnnotationRail: select-to-annotate mints a new corpus version,
 * blocking threads gate the verdict bar's approve, resolve re-enables it,
 * and orphaned threads render in their own always-visible section.
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

async function pushDoc(context: BrowserContext, html: string, kind: "plan" | "design" | "interface" = "design") {
	const response = await context.request.post("/api/v1/docs", {
		data: { project_id: E2E_OUTLINE_PROJECT_ID, kind, title: "E2E annotations doc", html },
	});
	expect(response.ok()).toBeTruthy();
	return response.json() as Promise<{ id: string; head_version: string }>;
}

async function requestCheckpoint(context: BrowserContext, document_id: string) {
	const response = await context.request.post("/api/v1/signoffs", {
		data: {
			project_id: E2E_OUTLINE_PROJECT_ID,
			subject_kind: "doc_version",
			subject_id: document_id,
			checkpoint: "design",
			blocks: [],
		},
	});
	expect(response.ok()).toBeTruthy();
	return response.json() as Promise<{ signoff: { id: string }; task_id: string }>;
}

/** `request_checkpoint` creates a real pending signoff owned by the SHARED e2e test user, surfaced globally by the "reviews pending" aggregate — waiting-on-you.spec.ts's "collapses to nothing" test asserts exactly zero of these exist. Called via `finally` so a mid-test assertion failure (or a flaky retry) still decides it, rather than leaking across spec files in a full-suite run. */
async function decideCheckpoint(
	context: BrowserContext,
	signoff_id: string,
	decision: "approved" | "changes_requested",
) {
	await context.request.post(`/api/v1/signoffs/${signoff_id}/decide`, { data: { decision } });
}

async function openDoc(page: Page, context: BrowserContext, documentId: string) {
	await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
	await page.waitForLoadState("networkidle");
	const target = page.locator(`[data-testid="doc-list-item"][data-document-id="${documentId}"]`);
	await target.click();
	try {
		await expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 3000 });
	} catch {
		await target.click();
		await expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 3000 });
	}
	await expect(page.getByTestId("doc-render-frame")).toBeVisible();
}

async function selectWordInFrame(page: Page, word: string) {
	const frame = page.frameLocator('[data-testid="doc-render-frame"]');
	const target = frame.locator(`text=${word}`).first();
	await target.evaluate((el, w) => {
		const text = el.textContent ?? "";
		const idx = text.indexOf(w);
		const textNode = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) ?? el.firstChild;
		if (!textNode) return;
		const range = document.createRange();
		range.setStart(textNode, Math.max(0, idx));
		range.setEnd(textNode, Math.max(0, idx) + w.length);
		const sel = el.ownerDocument.defaultView?.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}, word);
}

test.describe("AnnotationRail", () => {
	test.describe.configure({ mode: "serial" });

	test("select→annotate creates a thread that survives reload (new version)", async ({ page, context }) => {
		// A `page.reload()` mid-test can re-trigger vite recompilation on a cold
		// dev server, on top of this test's own open/select/save/reload/reopen
		// sequence — give it real headroom rather than fighting the default
		// 45s budget with retries alone.
		test.setTimeout(75_000);
		await inject_test_user(context);
		const doc = await pushDoc(context, "<h1>Design</h1><p>The quick brown fox jumps over the lazy dog.</p>");
		await openDoc(page, context, doc.id);

		await selectWordInFrame(page, "brown fox");
		await page.getByTestId("new-thread-button").click();
		await expect(page.getByTestId("thread-composer")).toBeVisible();

		await page.getByTestId("thread-composer").locator("textarea").fill("seems off");
		await page.getByTestId("thread-save").click();

		const card = page.getByTestId("thread-card").filter({ hasText: "seems off" });
		await expect(card).toBeVisible();
		await expect(card).toContainText("open");

		// `networkidle` after a RELOAD (not the first cold `goto`) is flaky here
		// — vite's HMR client keeps a persistent WebSocket open, which can keep
		// the page from ever reading "idle". The island's JS is already in
		// vite's dev cache from the first load, so a click-retry is reliable
		// enough for a reload specifically (unlike the cold-compile case).
		await page.reload();
		const target = page.locator(`[data-testid="doc-list-item"][data-document-id="${doc.id}"]`);
		await target.click();
		try {
			await expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 5000 });
		} catch {
			await target.click();
			await expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 5000 });
		}
		await expect(page.getByTestId("thread-card").filter({ hasText: "seems off" })).toBeVisible();
	});

	test("a blocking thread disables approve and lists itself; resolving re-enables it", async ({ page, context }) => {
		await inject_test_user(context);
		const doc = await pushDoc(context, "<h1>Design</h1><p>The quick brown fox jumps over the lazy dog.</p>");
		const requested = await requestCheckpoint(context, doc.id);

		try {
			await openDoc(page, context, doc.id);

			await expect(page.getByTestId("verdict-bar")).toBeVisible();
			await expect(page.getByTestId("verdict-approve")).toBeEnabled();

			await selectWordInFrame(page, "lazy dog");
			await page.getByTestId("new-thread-button").click();
			await page.getByTestId("thread-composer").locator("textarea").fill("blocking note");
			await page.getByTestId("thread-composer").locator('input[type="checkbox"]').check();
			await page.getByTestId("thread-save").click();

			await expect(page.getByTestId("verdict-blocked-note")).toContainText("lazy dog");
			await expect(page.getByTestId("verdict-approve")).toBeDisabled();

			const card = page.getByTestId("thread-card").filter({ hasText: "blocking note" });
			await card.getByTestId("thread-resolve").click();
			await expect(card).toContainText("resolved");
			await expect(page.getByTestId("verdict-approve")).toBeEnabled();

			await page.getByTestId("verdict-approve").click();
			await expect(page.getByTestId("verdict-bar")).toHaveCount(0);
		} finally {
			// Runs even on a mid-test assertion failure (a flaky retry attempt
			// included) — see `decideCheckpoint`'s doc comment on why an
			// undecided signoff here leaks into an unrelated spec file's
			// "zero pending reviews" assertion in a full-suite run.
			await decideCheckpoint(context, requested.signoff.id, "approved");
		}
	});

	test("an orphaned thread (anchor not found) renders in its own always-visible section", async ({ page, context }) => {
		await inject_test_user(context);
		// A doc pushed WITH an already-embedded marker whose quote never
		// appears in the content — `push_document_annotated`'s reconcile()
		// can never resolve it, so it lands as `orphaned` on the very first
		// push (never a hidden or dropped thread).
		const marker = {
			id: "thread_e2e-orphan-1",
			anchor: { quote: "text that does not exist in this doc", prefix: "", suffix: "", start: 0, end: 10 },
			status: "open",
			blocking: false,
			entries: [{ author: "tester", channel: "user", body: "orphan seed", at: new Date().toISOString() }],
		};
		const payload = Buffer.from(JSON.stringify(marker), "utf-8").toString("base64");
		const html = `<h1>Design</h1><p>Real content here.</p><!-- devpad:thread:begin ${marker.id} ${payload} -->x<!-- devpad:thread:end ${marker.id} -->`;
		const doc = await pushDoc(context, html);
		await openDoc(page, context, doc.id);

		const orphanSection = page.getByTestId("orphaned-thread-list");
		await expect(orphanSection).toBeVisible();
		await expect(orphanSection.getByTestId("orphaned-thread-card")).toContainText("orphan seed");
	});

	test("clicking a thread card's quote scrolls the iframe to its <mark> and flashes it (fast-follow #4)", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		// A pre-embedded, reconcilable marker (see `push_document_annotated`'s
		// reconcile() — `annotations.spec.ts`'s orphan test above uses the same
		// direct-push trick) bracketing text pushed FAR below the fold, so a
		// real scroll has to happen for the assertion to pass.
		const marker = {
			id: "thread_e2e-anchor-1",
			anchor: { quote: "brown fox", prefix: "", suffix: "", start: 0, end: 0 },
			status: "open",
			blocking: false,
			entries: [{ author: "tester", channel: "user", body: "anchor connection check", at: new Date().toISOString() }],
		};
		const payload = Buffer.from(JSON.stringify(marker), "utf-8").toString("base64");
		const filler = Array.from({ length: 80 }, (_, i) => `<p>filler line ${String(i)}</p>`).join("");
		const html = `<h1>Design</h1>${filler}<p>The quick <!-- devpad:thread:begin ${marker.id} ${payload} -->brown fox<!-- devpad:thread:end ${marker.id} --> jumps over the lazy dog.</p>`;
		const doc = await pushDoc(context, html);
		await openDoc(page, context, doc.id);

		const card = page.getByTestId("thread-card").filter({ hasText: "anchor connection check" });
		await expect(card).toBeVisible();

		const iframeHandle = await page.locator('[data-testid="doc-render-frame"]').elementHandle();
		const frame = await iframeHandle?.contentFrame();
		if (!frame) throw new Error("render iframe has no content frame");
		expect(await frame.evaluate(() => window.scrollY)).toBe(0);

		await card.getByTestId("thread-quote").click();

		await expect.poll(() => frame.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(0);
		const mark = frame.locator(`mark[data-thread-id="${marker.id}"]`);
		await expect(mark).toHaveClass(/mark-flash/);
		// The flash class is timed off after 1.2s (see `annotation-rail.tsx`'s
		// `scrollToMark`) — it's a transient highlight, not a permanent state.
		await expect(mark).not.toHaveClass(/mark-flash/, { timeout: 3000 });
	});

	test("save preserves the iframe's reading position and labels the new head version chip (fast-follow #5)", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		const filler = Array.from({ length: 80 }, (_, i) => `<p>filler line ${String(i)}</p>`).join("");
		const doc = await pushDoc(context, `<h1>Design</h1>${filler}<p>The quick brown fox jumps over the lazy dog.</p>`);
		await openDoc(page, context, doc.id);

		const getFrame = async () => {
			const handle = await page.locator('[data-testid="doc-render-frame"]').elementHandle();
			const frame = await handle?.contentFrame();
			if (!frame) throw new Error("render iframe has no content frame");
			return frame;
		};

		const frameBefore = await getFrame();
		await frameBefore.evaluate(() => window.scrollTo(0, 2000));
		expect(await frameBefore.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

		await selectWordInFrame(page, "brown fox");
		await page.getByTestId("new-thread-button").click();
		await page.getByTestId("thread-composer").locator("textarea").fill("reading position check");
		await page.getByTestId("thread-save").click();

		await expect(page.getByTestId("thread-card").filter({ hasText: "reading position check" })).toBeVisible();
		await expect(page.getByTestId("doc-version-just-now")).toBeVisible();

		// The iframe navigates to the new head version on save — re-fetch the
		// content frame each poll attempt, since the OLD `Frame` reference is
		// detached the moment that navigation starts.
		await expect
			.poll(
				async () => {
					const frame = await getFrame();
					return frame.evaluate(() => window.scrollY).catch(() => -1);
				},
				{ timeout: 5000 },
			)
			.toBeGreaterThan(1000);
	});
});
