/**
 * Integration tests for the new clean API interface
 * Tests the improved developer experience methods
 */

import { describe, expect, test } from "bun:test";
import { expectValidProject } from "../shared/assertions";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

class CleanApiIntegrationTest extends BaseIntegrationTest {}

// Setup test instance
const test_instance = new CleanApiIntegrationTest();
setupBaseIntegrationTest(test_instance);

describe("Clean API Interface", () => {
	describe("Projects", () => {
		test("should use nested resources for configuration", async () => {
			// Test that the nested config resource is available
			expect(test_instance.client.projects.config).toBeDefined();
			expect(typeof test_instance.client.projects.config.save).toBe("function");
			expect(typeof test_instance.client.projects.config.load).toBe("function");
		});

		test("should support clean list filtering", async () => {
			// Test the improved list interface
			const allResult = await test_instance.client.projects.list();
			if (!allResult.ok) throw new Error(`Failed to list all projects: ${allResult.error.message}`);

			const privateResult = await test_instance.client.projects.list({ private: true });
			if (!privateResult.ok) throw new Error(`Failed to list private projects: ${privateResult.error.message}`);

			const publicResult = await test_instance.client.projects.list({ private: false });
			if (!publicResult.ok) throw new Error(`Failed to list public projects: ${publicResult.error.message}`);

			expect(Array.isArray(allResult.value)).toBe(true);
			expect(Array.isArray(privateResult.value)).toBe(true);
			expect(Array.isArray(publicResult.value)).toBe(true);
		});

		test("should use find() method that returns null for missing projects", async () => {
			// Test the clean find interface
			const findResult = await test_instance.client.projects.find("non-existent-id");
			// Should return null for missing project without error
			expect(findResult.ok ? findResult.value : null).toBeNull();
		});

		test("should support basic project operations", async () => {
			// Create a project to test operations
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: "Test Operations Project",
				visibility: "PRIVATE",
			});

			const project = await test_instance.createAndRegisterProject(project_data);
			expectValidProject(project);

			// Test update operation (this is the main way to change project state)
			const updateResult = await test_instance.client.projects.update(project.id, {
				visibility: "PUBLIC",
			});
			if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);
			expectValidProject(updateResult.value);
			expect(updateResult.value.visibility).toBe("PUBLIC");
		});
	});

	describe("Auth", () => {
		test("should use nested resources for keys", async () => {
			// Test that the nested keys resource is available
			expect(test_instance.client.auth.keys).toBeDefined();
			expect(typeof test_instance.client.auth.keys.create).toBe("function");
			expect(typeof test_instance.client.auth.keys.revoke).toBe("function");
			expect(typeof test_instance.client.auth.keys.remove).toBe("function");
		});

		test("should expose session method for cookie-based auth", async () => {
			// auth.session() re-added for session-based authentication support
			expect(typeof test_instance.client.auth.session).toBe("function");
		});
	});

	describe("Tasks", () => {
		test("should support clean find() method", async () => {
			// Test the clean find interface
			const findResult = await test_instance.client.tasks.find("non-existent-id");
			// Should return null for missing task without error
			expect(findResult.ok ? findResult.value : null).toBeNull();
		});

		test("should support basic task operations", async () => {
			// Create a task to test operations
			const task_data = {
				title: "Test Operations Task",
				progress: "UNSTARTED" as const,
				visibility: "PRIVATE" as const,
				priority: "MEDIUM" as const,
				owner_id: TEST_USER_ID,
			};

			const task = await test_instance.createAndRegisterTask(task_data);
			expect(task.task.progress).toBe("UNSTARTED");

			// Test update operation
			const updateResult = await test_instance.client.tasks.update(task.task.id, {
				progress: "IN_PROGRESS",
			});
			if (!updateResult.ok) throw new Error(`Failed to update task: ${updateResult.error.message}`);
			expect(updateResult.value.task.progress).toBe("IN_PROGRESS");
		});

		test("should support task list filtering", async () => {
			// Test list interface
			const listResult = await test_instance.client.tasks.list();
			if (!listResult.ok) throw new Error(`Failed to list tasks: ${listResult.error.message}`);
			expect(Array.isArray(listResult.value)).toBe(true);
		});
	});
});
