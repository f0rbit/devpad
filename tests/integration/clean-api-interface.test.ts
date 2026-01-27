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
			const { projects: all_projects, error: all_error } = await test_instance.client.projects.list();
			if (all_error) throw new Error(`Failed to list all projects: ${all_error.message}`);

			const { projects: private_projects, error: private_error } = await test_instance.client.projects.list({ private: true });
			if (private_error) throw new Error(`Failed to list private projects: ${private_error.message}`);

			const { projects: public_projects, error: public_error } = await test_instance.client.projects.list({ private: false });
			if (public_error) throw new Error(`Failed to list public projects: ${public_error.message}`);

			expect(Array.isArray(all_projects)).toBe(true);
			expect(Array.isArray(private_projects)).toBe(true);
			expect(Array.isArray(public_projects)).toBe(true);
		});

		test("should use find() method that returns null for missing projects", async () => {
			// Test the clean find interface
			const { project: non_existent_project, error } = await test_instance.client.projects.find("non-existent-id");
			// Should return null for missing project without error
			expect(non_existent_project).toBeNull();
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
			const { project: updated_project, error: update_error } = await test_instance.client.projects.update(project.id, {
				visibility: "PUBLIC",
			});
			if (update_error) throw new Error(`Failed to update project: ${update_error.message}`);
			expectValidProject(updated_project!);
			expect(updated_project!.visibility).toBe("PUBLIC");
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

		test("should not expose removed session method", async () => {
			// auth.session() was removed during API consolidation - sessions handled by worker middleware
			expect(test_instance.client.auth.session).toBeUndefined();
		});
	});

	describe("Tasks", () => {
		test("should support clean find() method", async () => {
			// Test the clean find interface
			const { task: non_existent_task, error } = await test_instance.client.tasks.find("non-existent-id");
			// Should return null for missing task without error
			expect(non_existent_task).toBeNull();
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
			const { task: updated_task, error: update_error } = await test_instance.client.tasks.update(task.task.id, {
				progress: "IN_PROGRESS",
			});
			if (update_error) throw new Error(`Failed to update task: ${update_error.message}`);
			expect(updated_task!.task.progress).toBe("IN_PROGRESS");
		});

		test("should support task list filtering", async () => {
			// Test list interface
			const { tasks, error } = await test_instance.client.tasks.list();
			if (error) throw new Error(`Failed to list tasks: ${error.message}`);
			expect(Array.isArray(tasks)).toBe(true);
		});
	});
});
