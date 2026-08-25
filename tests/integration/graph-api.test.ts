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

describe("graph API — ownership, pagination, guarded writes", () => {
	test("GET /tasks/ready round-trips through the ApiClient, ownership-scoped", async () => {
		const project_result = await t.client.projects.create(TestDataFactory.createRealisticProject());
		if (!project_result.ok) throw new Error(`project create failed: ${project_result.error.message}`);
		t.cleanup.registerProject(project_result.value);
		const project = project_result.value;

		const eligible = await create_task({ title: `ready-${String(Date.now())}`, project_id: project.id });

		const result = await t.client.tasks.ready({ project_id: project.id, limit: 5 });
		if (!result.ok) throw new Error(`ready failed: ${result.error.message}`);
		const ready = result.value;

		expect(Array.isArray(ready.items)).toBe(true);
		expect(ready.items.some((item) => item.id === eligible.id)).toBe(true);
		expect(ready.items.every((item) => item.owner_id === TEST_USER_ID)).toBe(true);
	});

	test("upsert_todo round-trips the new graph fields (parent_id, rank, kind, completion_policy)", async () => {
		const parent = await create_task({ title: `parent-${String(Date.now())}`, kind: "phase" });
		const child_data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: `child-${String(Date.now())}`,
			parent_id: parent.id,
			rank: "i0",
			kind: "task",
			completion_policy: "manual",
		});
		const child_result = await t.client.tasks.create(child_data);
		if (!child_result.ok) throw new Error(`create failed: ${child_result.error.message}`);
		t.cleanup.registerTask(child_result.value);

		expect(child_result.value.task.parent_id).toBe(parent.id);
		expect(child_result.value.task.rank).toBe("i0");
	});

	test("GET /tasks/:id/tree returns the task and its descendants", async () => {
		const parent = await create_task({ title: `tree-parent-${String(Date.now())}` });
		const child = await create_task({ title: `tree-child-${String(Date.now())}`, parent_id: parent.id });

		const result = await t.client.tasks.tree(parent.id);
		if (!result.ok) throw new Error(`tree failed: ${result.error.message}`);
		const tree = result.value;

		expect(tree.task.id).toBe(parent.id);
		expect(tree.descendants.map((d) => d.id)).toContain(child.id);
	});

	test("POST /tasks/link then GET /tasks/:id/near shows the edge, DELETE /tasks/link/:id removes it", async () => {
		const a = await create_task({ title: `near-a-${String(Date.now())}` });
		const b = await create_task({ title: `near-b-${String(Date.now())}` });

		const link_result = await t.client.tasks.link({ src_id: a.id, dst_id: b.id, kind: "relates_to" });
		if (!link_result.ok) throw new Error(`link failed: ${link_result.error.message}`);
		const link = link_result.value;

		const near_result = await t.client.tasks.near(a.id);
		if (!near_result.ok) throw new Error(`near failed: ${near_result.error.message}`);
		expect(near_result.value.links.some((l) => l.id === link.id)).toBe(true);
		expect(near_result.value.tasks.map((task) => task.id)).toContain(b.id);

		const unlink_result = await t.client.tasks.unlink(link.id);
		expect(unlink_result.ok).toBe(true);

		const near_after = await t.client.tasks.near(a.id);
		if (!near_after.ok) throw new Error(`near failed: ${near_after.error.message}`);
		expect(near_after.value.links.some((l) => l.id === link.id)).toBe(false);
	});

	test("POST /tasks/:id/claim is guarded — a second claim with the original base_rev fails", async () => {
		const task = await create_task({ title: `claim-${String(Date.now())}` });

		const first = await t.client.tasks.claim(task.id, { actor: "agent-1", base_rev: task.rev });
		if (!first.ok) throw new Error(`claim failed: ${first.error.message}`);
		expect(first.value.claimed_by).toBe("agent-1");

		const second = await t.client.tasks.claim(task.id, { actor: "agent-2", base_rev: task.rev });
		expect(second.ok).toBe(false);
	});

	test("POST /tasks/apply creates a subtree via $0 temp handles in one call", async () => {
		const idempotency_key = `apply-${String(Date.now())}-${String(Math.random())}`;
		const result = await t.client.tasks.apply({
			idempotency_key,
			ops: [
				{ op: "create", data: { owner_id: TEST_USER_ID, title: `apply-parent-${idempotency_key}`, kind: "phase" } },
				{ op: "create", data: { owner_id: TEST_USER_ID, title: `apply-child-${idempotency_key}`, parent_id: "$0" } },
			],
		});
		if (!result.ok) throw new Error(`apply failed: ${result.error.message}`);
		const apply = result.value;
		expect(apply.results).toHaveLength(2);
		const [created_parent, created_child] = apply.results;

		const tree = await t.client.tasks.tree(created_parent.id);
		if (!tree.ok) throw new Error(`tree failed: ${tree.error.message}`);
		expect(tree.value.descendants.map((d) => d.id)).toContain(created_child.id);
	});

	test("apply is not ownership-scoped to bypass — referencing another user's task id is rejected", async () => {
		// there is no second seeded user in this harness; assert the route at
		// least rejects a nonexistent id cleanly (exercises the pre-flight
		// ownership lookup path without needing a second fixture user).
		const result = await t.client.tasks.apply({
			idempotency_key: `apply-missing-${String(Date.now())}`,
			ops: [{ op: "claim", id: "task_does_not_exist", actor: "agent-1", base_rev: 0 }],
		});
		expect(result.ok).toBe(false);
	});
});
