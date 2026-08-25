import { beforeAll, describe, expect, test } from "bun:test";
import { ApiClient } from "@devpad/api";
import type { Project } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_BASE_URL, TEST_USER_ID } from "./setup";

const t = setupIntegration();

async function createScopedClient(project_id?: string): Promise<ApiClient> {
	const result = await t.client.auth.keys.create({ scope: "devpad", project_id });
	if (!result.ok) throw new Error(`Failed to mint API key: ${result.error.message}`);
	return new ApiClient({ api_key: result.value.key.raw_key, base_url: TEST_BASE_URL });
}

describe("Per-project scoped API keys (task A3.1)", () => {
	let project_a: Project;
	let project_b: Project;

	beforeAll(async () => {
		const a = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!a.ok) throw new Error(`Failed to create project A: ${a.error.message}`);
		t.cleanup.registerProject(a.value);
		project_a = a.value;

		const b = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!b.ok) throw new Error(`Failed to create project B: ${b.error.message}`);
		t.cleanup.registerProject(b.value);
		project_b = b.value;
	});

	test("a key scoped to project A can create and read a task in project A", async () => {
		const scoped = await createScopedClient(project_a.id);

		const created = await scoped.tasks.create({
			title: "in-scope task",
			project_id: project_a.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		t.cleanup.registerTask(created.value);

		const fetched = await scoped.tasks.find(created.value.task.id);
		expect(fetched.ok).toBe(true);
	});

	test("a key scoped to project A gets 403 reading a task in project B", async () => {
		const scoped = await createScopedClient(project_a.id);

		const task_b = await t.client.tasks.create({
			title: "out-of-scope task",
			project_id: project_b.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(task_b.ok).toBe(true);
		if (!task_b.ok) return;
		t.cleanup.registerTask(task_b.value);

		const fetched = await scoped.tasks.find(task_b.value.task.id);
		expect(fetched.ok).toBe(false);
		if (fetched.ok) return;
		expect(fetched.error.status_code).toBe(403);
	});

	test("a key scoped to project A gets 403 creating a task in project B", async () => {
		const scoped = await createScopedClient(project_a.id);

		const created = await scoped.tasks.create({
			title: "cross-project create attempt",
			project_id: project_b.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(created.ok).toBe(false);
		if (created.ok) return;
		expect(created.error.status_code).toBe(403);
	});

	test("a legacy null-scope key reads/writes any of the user's projects unaffected", async () => {
		const legacy = await createScopedClient(undefined);

		const task_a = await legacy.tasks.create({
			title: "legacy key task in A",
			project_id: project_a.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(task_a.ok).toBe(true);
		if (task_a.ok) t.cleanup.registerTask(task_a.value);

		const task_b = await legacy.tasks.create({
			title: "legacy key task in B",
			project_id: project_b.id,
			owner_id: TEST_USER_ID,
			progress: "UNSTARTED",
			priority: "MEDIUM",
		});
		expect(task_b.ok).toBe(true);
		if (task_b.ok) t.cleanup.registerTask(task_b.value);
	});
});
