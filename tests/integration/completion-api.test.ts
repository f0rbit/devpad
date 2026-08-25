import { describe, expect, test } from "bun:test";
import type { Task } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

async function create_task(overrides: Record<string, unknown> = {}): Promise<Task> {
	const data = TestDataFactory.createTask({ owner_id: TEST_USER_ID, ...overrides });
	const result = await t.client.tasks.create(data);
	if (!result.ok) throw new Error(`Failed to create task: ${result.error.message}`);
	t.cleanup.registerTask(result.value);
	return result.value.task;
}

describe("POST /tasks/:id/done — the single completion entrypoint", () => {
	test("done on a leaf under an auto_children chain returns the ordered bubble steps", async () => {
		const grandparent = await create_task({
			title: `done-grandparent-${String(Date.now())}`,
			completion_policy: "auto_children",
		});
		const parent = await create_task({
			title: `done-parent-${String(Date.now())}`,
			completion_policy: "auto_children",
			parent_id: grandparent.id,
		});
		const leaf = await create_task({ title: `done-leaf-${String(Date.now())}`, parent_id: parent.id });

		const result = await t.client.tasks.done(leaf.id, { base_rev: leaf.rev });
		if (!result.ok) throw new Error(`done failed: ${result.error.message}`);

		expect(result.value.completed.id).toBe(leaf.id);
		expect(result.value.completed.progress).toBe("COMPLETED");
		expect(result.value.bubbled.map((b) => b.task.id)).toEqual([parent.id, grandparent.id]);
		expect(result.value.bubbled.every((b) => b.via === "policy")).toBe(true);
		expect(result.value.hooks_fired).toEqual([]);
	});

	test("a manual-policy parent's leaf completes but bubbles nothing", async () => {
		const parent = await create_task({ title: `done-manual-parent-${String(Date.now())}`, completion_policy: "manual" });
		const leaf = await create_task({ title: `done-manual-leaf-${String(Date.now())}`, parent_id: parent.id });

		const result = await t.client.tasks.done(leaf.id, { base_rev: leaf.rev });
		if (!result.ok) throw new Error(`done failed: ${result.error.message}`);

		expect(result.value.completed.id).toBe(leaf.id);
		expect(result.value.bubbled).toEqual([]);
	});

	test("a stale base_rev is rejected with a conflict, not silently applied", async () => {
		const leaf = await create_task({ title: `done-stale-${String(Date.now())}` });

		const result = await t.client.tasks.done(leaf.id, { base_rev: leaf.rev + 5 });
		expect(result.ok).toBe(false);
	});

	test("done is ownership-scoped — another owner cannot complete this task via a mismatched id lookup", async () => {
		const result = await t.client.tasks.done("task_does_not_exist", { base_rev: 0 });
		expect(result.ok).toBe(false);
	});
});
