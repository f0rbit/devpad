import { describe, expect, test } from "bun:test";
import { expectValidProject } from "../shared/assertions";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

describe("Clean API Interface", () => {
	describe("Projects", () => {
		test("should use nested resources for configuration", async () => {
			expect(t.client.projects.config).toBeDefined();
			expect(typeof t.client.projects.config.save).toBe("function");
			expect(typeof t.client.projects.config.load).toBe("function");
		});

		test("should support clean list filtering", async () => {
			const allResult = await t.client.projects.list();
			if (!allResult.ok) throw new Error(`Failed to list all projects: ${allResult.error.message}`);

			const privateResult = await t.client.projects.list({ private: true });
			if (!privateResult.ok) throw new Error(`Failed to list private projects: ${privateResult.error.message}`);

			const publicResult = await t.client.projects.list({ private: false });
			if (!publicResult.ok) throw new Error(`Failed to list public projects: ${publicResult.error.message}`);

			expect(Array.isArray(allResult.value)).toBe(true);
			expect(Array.isArray(privateResult.value)).toBe(true);
			expect(Array.isArray(publicResult.value)).toBe(true);
		});

		test("should use find() method that returns null for missing projects", async () => {
			const findResult = await t.client.projects.find("non-existent-id");
			expect(findResult.ok ? findResult.value : null).toBeNull();
		});

		test("should support basic project operations", async () => {
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: "Test Operations Project",
				visibility: "PRIVATE",
			});

			const result = await t.client.projects.create(project_data);
			if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
			t.cleanup.registerProject(result.value);
			const project = result.value;
			expectValidProject(project);

			const updateResult = await t.client.projects.update(project.id, {
				visibility: "PUBLIC",
			});
			if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);
			expectValidProject(updateResult.value);
			expect(updateResult.value.visibility).toBe("PUBLIC");
		});
	});

	describe("Auth", () => {
		test("should use nested resources for keys", async () => {
			expect(t.client.auth.keys).toBeDefined();
			expect(typeof t.client.auth.keys.create).toBe("function");
			expect(typeof t.client.auth.keys.revoke).toBe("function");
			expect(typeof t.client.auth.keys.remove).toBe("function");
		});

		test("should expose session method for cookie-based auth", async () => {
			expect(typeof t.client.auth.session).toBe("function");
		});
	});

	describe("Tasks", () => {
		test("should support clean find() method", async () => {
			const findResult = await t.client.tasks.find("non-existent-id");
			expect(findResult.ok ? findResult.value : null).toBeNull();
		});

		test("should support basic task operations", async () => {
			const task_data = {
				title: "Test Operations Task",
				progress: "UNSTARTED" as const,
				visibility: "PRIVATE" as const,
				priority: "MEDIUM" as const,
				owner_id: TEST_USER_ID,
			};

			const result = await t.client.tasks.create(task_data);
			if (!result.ok) throw new Error(`Failed to create task: ${result.error.message}`);
			t.cleanup.registerTask(result.value);
			const task = result.value;
			expect(task.task.progress).toBe("UNSTARTED");

			const updateResult = await t.client.tasks.update(task.task.id, {
				progress: "IN_PROGRESS",
			});
			if (!updateResult.ok) throw new Error(`Failed to update task: ${updateResult.error.message}`);
			expect(updateResult.value.task.progress).toBe("IN_PROGRESS");
		});

		test("should support task list filtering", async () => {
			const listResult = await t.client.tasks.list();
			if (!listResult.ok) throw new Error(`Failed to list tasks: ${listResult.error.message}`);
			expect(Array.isArray(listResult.value)).toBe(true);
		});
	});
});
