import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

describe("task history and save_tags integration", () => {
	describe("task history", () => {
		let project_id = "";
		let task_id = "";

		test("setup: create project for task history tests", async () => {
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: "History Test Project",
			});
			const result = await t.client.projects.upsert({
				...project_data,
				owner_id: TEST_USER_ID,
			});
			if (!result.ok) {
				throw new Error(`Failed to create project: ${result.error.message}`);
			}
			t.cleanup.registerProject(result.value);
			project_id = result.value.id;
			expect(result.value.id).toBeDefined();
		});

		test("setup: create a task", async () => {
			const task_data = TestDataFactory.createTask({
				owner_id: TEST_USER_ID,
				project_id,
				title: "History Test Task",
			});
			const result = await t.client.tasks.create(task_data);
			if (!result.ok) {
				throw new Error(`Failed to create task: ${result.error.message}`);
			}
			t.cleanup.registerTask(result.value);
			task_id = result.value.task.id;
			expect(task_id).toBeDefined();
		});

		test("should get task history with creation action", async () => {
			const result = await t.client.tasks.history.get(task_id);
			if (!result.ok) {
				throw new Error(`Failed to get task history: ${result.error.message}`);
			}

			expect(Array.isArray(result.value)).toBe(true);
		});

		test("should return error for non-existent task history", async () => {
			const result = await t.client.tasks.history.get("non-existent-task-id");
			expect(result.ok).toBe(false);
		});

		test("cleanup: delete task and project handled by cleanup manager", () => {
			expect(task_id).toBeDefined();
			expect(project_id).toBeDefined();
		});
	});

	describe("save_tags", () => {
		test("should save a single tag", async () => {
			const tag_data = [
				{
					title: `save-tag-${Date.now()}`,
					color: "red" as const,
					owner_id: TEST_USER_ID,
					render: true,
				},
			];

			const result = await t.client.tasks.saveTags(tag_data);
			if (!result.ok) {
				throw new Error(`Failed to save tags: ${result.error.message}`);
			}

			expect(result.ok).toBe(true);
		});

		test("should save multiple tags at once", async () => {
			const tag_data = [
				{ title: `multi-tag-a-${Date.now()}`, color: "blue" as const, owner_id: TEST_USER_ID },
				{ title: `multi-tag-b-${Date.now()}`, color: "green" as const, owner_id: TEST_USER_ID },
				{ title: `multi-tag-c-${Date.now()}`, color: "yellow" as const, owner_id: TEST_USER_ID },
			];

			const result = await t.client.tasks.saveTags(tag_data);
			if (!result.ok) {
				throw new Error(`Failed to save multiple tags: ${result.error.message}`);
			}

			expect(result.ok).toBe(true);
		});

		test("should handle empty tag array", async () => {
			const result = await t.client.tasks.saveTags([]);
			expect(result.ok).toBe(true);
		});

		test("should reject tag with mismatched owner_id", async () => {
			const tag_data = [
				{
					title: `bad-owner-tag-${Date.now()}`,
					color: "red" as const,
					owner_id: "some-other-user-id",
				},
			];

			const result = await t.client.tasks.saveTags(tag_data);
			expect(result.ok).toBe(false);
		});
	});
});
