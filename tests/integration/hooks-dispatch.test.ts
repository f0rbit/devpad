import { beforeAll, describe, expect, test } from "bun:test";
import type { Project } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

async function waitFor(check: () => Promise<boolean>, timeout_ms = 2000): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeout_ms) {
		if (await check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	return false;
}

describe("Hook dispatch, end to end through the worker (task A3.3)", () => {
	let project: Project;

	beforeAll(async () => {
		const created = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!created.ok) throw new Error(`Failed to create project: ${created.error.message}`);
		t.cleanup.registerProject(created.value);
		project = created.value;
	});

	test("completing a task fires the outbox event, which the worker drains into a hook_delivery row", async () => {
		const hook_created = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(hook_created.ok).toBe(true);
		if (!hook_created.ok) return;

		const task_created = await t.client.tasks.create({
			title: "task that should fire a hook on completion",
			project_id: project.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(task_created.ok).toBe(true);
		if (!task_created.ok) return;
		t.cleanup.registerTask(task_created.value);

		const done = await t.client.tasks.done(task_created.value.task.id, { base_rev: task_created.value.task.rev });
		expect(done.ok).toBe(true);

		const delivered = await waitFor(async () => {
			const deliveries = await t.client.hooks.deliveries(hook_created.value.id);
			return deliveries.ok && deliveries.value.length > 0 && deliveries.value[0]?.status === "delivered";
		});
		expect(delivered).toBe(true);
	});

	test("a hook with a non-matching kind never gets a delivery row", async () => {
		const hook_created = await t.client.hooks.upsert({
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["node.children_all_done"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(hook_created.ok).toBe(true);
		if (!hook_created.ok) return;

		const task_created = await t.client.tasks.create({
			title: "task that should NOT fire the children_all_done hook",
			project_id: project.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(task_created.ok).toBe(true);
		if (!task_created.ok) return;
		t.cleanup.registerTask(task_created.value);

		const done = await t.client.tasks.done(task_created.value.task.id, { base_rev: task_created.value.task.rev });
		expect(done.ok).toBe(true);

		// Give the drain middleware a moment, then assert no delivery ever showed up.
		await new Promise((resolve) => setTimeout(resolve, 200));
		const deliveries = await t.client.hooks.deliveries(hook_created.value.id);
		expect(deliveries.ok).toBe(true);
		if (deliveries.ok) expect(deliveries.value.length).toBe(0);
	});
});
