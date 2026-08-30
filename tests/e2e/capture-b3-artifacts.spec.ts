import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_STAGE_PLAN,
	E2E_TASK_STAGE_REVIEW,
} from "./fixtures/outline-ids";

type Theme = "light" | "dark";
type ManifestEntry = {
	file: string;
	viewport: { width: number; height: number };
	theme: Theme;
	ok: boolean;
};

const viewport = { width: 1440, height: 900 };
const screenshot_dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".plans", "screenshots");
const manifest_path = resolve(screenshot_dir, "manifest.json");
const manifest: ManifestEntry[] = [];
let navigated = false;

function write_manifest(): void {
	writeFileSync(manifest_path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const inject_test_user = async (context: BrowserContext) => {
	await context.route(
		() => true,
		async (route) => {
			await route.continue({ headers: { ...route.request().headers(), "X-Test-User": "true" } });
		},
	);
	await context.addCookies([{ name: "auth_session", value: E2E_SESSION_ID, domain: "localhost", path: "/" }]);
};

async function push_doc(
	context: BrowserContext,
	html: string,
	options: { title: string; task_id?: string; kind?: "plan" | "design" | "interface" },
): Promise<{ id: string }> {
	const response = await context.request.post("/api/v1/docs", {
		data: {
			project_id: E2E_OUTLINE_PROJECT_ID,
			task_id: options.task_id,
			kind: options.kind ?? "plan",
			title: options.title,
			html,
		},
	});
	expect(response.ok()).toBeTruthy();
	return response.json() as Promise<{ id: string }>;
}

async function push_interface_doc(context: BrowserContext, normalized: string): Promise<{ document: { id: string } }> {
	const response = await context.request.post("/api/v1/docs/interface", {
		data: {
			project_id: E2E_OUTLINE_PROJECT_ID,
			task_id: E2E_TASK_STAGE_REVIEW,
			title: "B3 interface report",
			normalized,
		},
	});
	expect(response.ok()).toBeTruthy();
	return response.json() as Promise<{ document: { id: string } }>;
}

async function push_interface_version(context: BrowserContext, document_id: string, normalized: string): Promise<void> {
	const response = await context.request.post("/api/v1/docs/interface", {
		data: {
			document_id,
			project_id: E2E_OUTLINE_PROJECT_ID,
			task_id: E2E_TASK_STAGE_REVIEW,
			title: "B3 interface report",
			normalized,
		},
	});
	expect(response.ok()).toBeTruthy();
}

async function open_doc(page: Page, document_id: string): Promise<void> {
	await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}/docs`);
	if (!navigated) {
		await page.waitForLoadState("networkidle");
		navigated = true;
	}
	const target = page.locator(`[data-testid="doc-list-item"][data-document-id="${document_id}"]`);
	await target.click();
	try {
		await expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 5000 });
	} catch {
		await target.click();
		await expect(page.getByTestId("doc-viewer")).toBeVisible({ timeout: 5000 });
	}
	await expect(page.getByTestId("doc-render-frame")).toBeVisible();
	await expect(page.frameLocator('[data-testid="doc-render-frame"]').locator("body")).toBeVisible();
}

async function open_node(page: Page, task_id: string): Promise<void> {
	await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?node=${task_id}&view=list`);
	await expect(page.getByTestId("sdlc-stepper")).toBeVisible();
}

async function capture(page: Page, theme: Theme, filename: string, ready: () => Promise<void>): Promise<void> {
	await page.emulateMedia({ colorScheme: theme });
	await ready();
	await expect(page.locator("body")).toBeVisible();
	await page.evaluate(() => document.querySelector("astro-dev-toolbar")?.remove());
	const output = resolve(screenshot_dir, filename);
	await page.screenshot({ path: output, fullPage: true });
	const ok = existsSync(output);
	expect(ok).toBeTruthy();
	manifest.push({ file: filename, viewport, theme, ok });
	write_manifest();
}

function marker(id: string, quote: string, body: string, status: "open" = "open") {
	return {
		id,
		anchor: { quote, prefix: "", suffix: "", start: 0, end: quote.length },
		status,
		blocking: false,
		entries: [{ author: "B3 reviewer", channel: "user", body, at: new Date().toISOString() }],
	};
}

function embed_marker(
	value: ReturnType<typeof marker>,
	content: string,
	marker_text = value.anchor.quote,
	suffix = "",
): string {
	const payload = Buffer.from(JSON.stringify(value), "utf-8").toString("base64");
	return `${content}<!-- devpad:thread:begin ${value.id} ${payload} -->${marker_text}<!-- devpad:thread:end ${value.id} -->${suffix}`;
}

test.describe("B3 proof artifacts", () => {
	test.skip(process.env.CAPTURE_B3 !== "1", "proof-artifact capture; run with CAPTURE_B3=1");
	test.describe.configure({ mode: "serial" });

	test("captures the review surfaces in light and dark themes", async ({ page, context }) => {
		test.setTimeout(180_000);
		await page.setViewportSize(viewport);
		manifest.length = 0;
		navigated = false;
		mkdirSync(screenshot_dir, { recursive: true });
		write_manifest();
		await inject_test_user(context);

		const open_thread = marker("thread_b3-open", "the plan needs review", "Open review note");
		const plan_doc = await push_doc(
			context,
			embed_marker(open_thread, "<h1>B3 review plan</h1><p>", open_thread.anchor.quote, "</p>"),
			{ title: "B3 review plan" },
		);
		const orphan_thread = marker("thread_b3-orphan", "this anchor is absent", "Orphaned review note");
		const orphan_doc = await push_doc(
			context,
			embed_marker(orphan_thread, "<h1>B3 orphaned review</h1><p>Visible content only.</p>", "orphan marker"),
			{ title: "B3 orphaned review" },
		);
		const plan_checkpoint_doc = await push_doc(context, "<h1>Plan checkpoint</h1><p>Ready for build review.</p>", {
			title: "B3 plan checkpoint",
			task_id: E2E_TASK_STAGE_PLAN,
		});
		const interface_doc = await push_interface_doc(
			context,
			"export function createWidget(): Widget;\nexport function removeWidget(): void;",
		);
		await push_interface_version(context, interface_doc.document.id, "export function createWidget(): Widget;");

		for (const theme of ["light", "dark"] as const) {
			await capture(page, theme, `b3-01-docviewer-plan-${theme}.png`, async () => {
				await open_doc(page, plan_doc.id);
				await expect(page.frameLocator('[data-testid="doc-render-frame"]').locator("h1")).toHaveText("B3 review plan");
			});
		}

		for (const theme of ["light", "dark"] as const) {
			await capture(page, theme, `b3-02-annotation-thread-rail-${theme}.png`, async () => {
				await open_doc(page, plan_doc.id);
				await expect(page.getByTestId("thread-card").filter({ hasText: "Open review note" })).toBeVisible();
			});
		}

		for (const theme of ["light", "dark"] as const) {
			await capture(page, theme, `b3-03-orphaned-thread-${theme}.png`, async () => {
				await open_doc(page, orphan_doc.id);
				await expect(page.getByTestId("orphaned-thread-list")).toBeVisible();
				await expect(page.getByTestId("orphaned-thread-card")).toContainText("Orphaned review note");
			});
		}

		for (const theme of ["light", "dark"] as const) {
			await capture(page, theme, `b3-04-interface-diff-view-${theme}.png`, async () => {
				await open_doc(page, interface_doc.document.id);
				await expect(page.getByTestId("doc-version-diff-link")).toBeVisible();
				await page.getByTestId("doc-version-diff-link").click();
				await expect(page.getByTestId("doc-diff-panel")).toBeVisible();
				await expect(page.locator(".doc-diff-remove")).toContainText("removeWidget");
			});
		}

		for (const theme of ["light", "dark"] as const) {
			await capture(page, theme, `b3-05-checkpoint-card-${theme}.png`, async () => {
				await open_node(page, E2E_TASK_STAGE_REVIEW);
				const card = page.getByTestId("checkpoint-card-types");
				await expect(card).toBeVisible();
				await expect(card.getByTestId("interface-classification-chip")).toHaveText("breaking");
				await expect(card.getByTestId("checkpoint-metric")).toContainText("tracked metric: error_rate");
			});
		}

		for (const theme of ["light", "dark"] as const) {
			await capture(page, theme, `b3-06-sdlc-stepper-${theme}.png`, async () => {
				await open_node(page, E2E_TASK_STAGE_PLAN);
				await expect(page.getByTestId("sdlc-stepper")).toBeVisible();
				const card = page.getByTestId("checkpoint-card-plan");
				await expect(card).toBeVisible();
				await expect(card.getByRole("link", { name: "View plan doc →" })).toHaveAttribute(
					"href",
					`/project/${E2E_OUTLINE_PROJECT_ID}/docs?doc=${plan_checkpoint_doc.id}`,
				);
			});
		}

		expect(manifest).toHaveLength(12);
		for (const entry of manifest) {
			expect(entry.ok).toBeTruthy();
			expect(existsSync(resolve(screenshot_dir, entry.file))).toBeTruthy();
		}
	});
});
