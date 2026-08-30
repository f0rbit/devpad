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

describe("GET /projects/:id/graph — canvas home whole-project read", () => {
	test("returns the project's tasks, links and rollups", async () => {
		const project_result = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!project_result.ok) throw new Error(`project create failed: ${project_result.error.message}`);
		t.cleanup.registerProject(project_result.value);
		const project = project_result.value;

		const parent = await create_task({ title: `graph-parent-${String(Date.now())}`, project_id: project.id });
		const child = await create_task({
			title: `graph-child-${String(Date.now())}`,
			project_id: project.id,
			parent_id: parent.id,
		});
		const link_result = await t.client.tasks.link({ src_id: parent.id, dst_id: child.id, kind: "relates_to" });
		if (!link_result.ok) throw new Error(`link failed: ${link_result.error.message}`);

		const result = await t.client.projects.graph(project.id);
		if (!result.ok) throw new Error(`graph failed: ${result.error.message}`);

		const task_ids = result.value.tasks.map((task) => task.id);
		expect(task_ids).toContain(parent.id);
		expect(task_ids).toContain(child.id);
		expect(result.value.links.some((link) => link.src_id === parent.id && link.dst_id === child.id)).toBe(true);
	});

	test("a nonexistent project returns not found", async () => {
		const result = await t.client.projects.graph("project_does_not_exist");
		expect(result.ok).toBe(false);
	});
});
