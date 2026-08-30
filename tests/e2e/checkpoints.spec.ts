import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_STAGE_PLAN,
	E2E_TASK_STAGE_REVIEW,
} from "./fixtures/outline-ids";

/**
 * Task B3.3 — SDLC stepper (gently-enforced gate + audited override) and
 * checkpoint cards (interface breaking/additive classification + the
 * tracks_metric pulse widget, degrading gracefully when pulse isn't
 * reachable).
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

async function gotoNode(page: Page, node: string) {
	await page.goto(`/project/${E2E_OUTLINE_PROJECT_ID}?node=${node}&view=list`);
	await page.waitForLoadState("networkidle");
}

async function pushInterfaceDoc(context: BrowserContext, task_id: string, normalized: string, document_id?: string) {
	const response = await context.request.post("/api/v1/docs/interface", {
		data: { document_id, project_id: E2E_OUTLINE_PROJECT_ID, task_id, title: "E2E interface report", normalized },
	});
	expect(response.ok()).toBeTruthy();
	return response.json() as Promise<{ document: { id: string } }>;
}

test.describe("SDLC stepper + checkpoint cards", () => {
	test.describe.configure({ mode: "serial" });

	test("gated advance is blocked and named; override modal audits the reason and advances", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		// Re-runs of this suite (this file isn't reseeded between runs, unlike
		// the static-SQL-fixture specs) leave the fixture task's `stage`
		// mutated from the previous run's override — reset it via the SAME
		// override mechanism (no gate is defined for build→plan, so this
		// succeeds ungated) so the test is idempotent across repeat runs.
		await context.request.post(`/api/v1/tasks/${E2E_TASK_STAGE_PLAN}/stage`, {
			data: { to: "plan", override: true, reason: "e2e reset" },
		});
		await gotoNode(page, E2E_TASK_STAGE_PLAN);

		const stepper = page.getByTestId("sdlc-stepper");
		await expect(stepper).toBeVisible();

		await stepper.locator('[data-stage="build"]').click();
		const errorNote = page.getByTestId("sdlc-stepper-error");
		await expect(errorNote).toBeVisible();
		await expect(errorNote).toContainText("plan");

		await page.getByTestId("sdlc-override-open").click();
		await page.getByTestId("sdlc-override-reason").fill("skipping for e2e — audited");
		await page.getByTestId("sdlc-override-submit").click();

		await expect(errorNote).toHaveCount(0);

		const task_response = await context.request.get(`/api/v1/tasks?id=${E2E_TASK_STAGE_PLAN}`);
		expect(task_response.ok()).toBeTruthy();
		const task_body = (await task_response.json()) as { task: { stage: string } };
		expect(task_body.task.stage).toBe("build");
	});

	test("breaking interface diff renders a chip, and the metric widget renders (or degrades gracefully)", async ({
		page,
		context,
	}) => {
		await inject_test_user(context);
		const first = await pushInterfaceDoc(
			context,
			E2E_TASK_STAGE_REVIEW,
			"export function foo(): void;\nexport function bar(): void;",
		);
		await pushInterfaceDoc(context, E2E_TASK_STAGE_REVIEW, "export function foo(): void;", first.document.id);

		await gotoNode(page, E2E_TASK_STAGE_REVIEW);

		const typesCard = page.getByTestId("checkpoint-card-types");
		await expect(typesCard).toBeVisible();
		await expect(typesCard.getByTestId("interface-classification-chip")).toHaveText("breaking");

		const metric = typesCard.getByTestId("checkpoint-metric");
		await expect(metric).toBeVisible();
		await expect(metric).toContainText("error_rate");
	});
});
