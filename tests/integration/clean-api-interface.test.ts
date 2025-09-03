/**
 * Integration tests for the new clean API interface
 * Tests the improved developer experience methods
 */

import { describe, test, expect } from "bun:test";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { expectValidProject } from "../shared/assertions";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

class CleanApiIntegrationTest extends BaseIntegrationTest {}

// Setup test instance
const testInstance = new CleanApiIntegrationTest();
setupBaseIntegrationTest(testInstance);

describe("Clean API Interface", () => {
	describe("Projects", () => {
		test("should use nested resources for configuration", async () => {
			// Test that the nested config resource is available
			expect(testInstance.client.projects.config).toBeDefined();
			expect(typeof testInstance.client.projects.config.save).toBe("function");
			expect(typeof testInstance.client.projects.config.load).toBe("function");
		});

		test("should use nested resources for specification", async () => {
			// Test that the nested specification resource is available
			expect(testInstance.client.projects.specification).toBeDefined();
			expect(typeof testInstance.client.projects.specification.load).toBe("function");
			expect(typeof testInstance.client.projects.specification.update).toBe("function");
		});

		test("should support clean list filtering", async () => {
			// Test the improved list interface
			const allProjects = await testInstance.client.projects.list();
			const privateProjects = await testInstance.client.projects.list({ private: true });
			const publicProjects = await testInstance.client.projects.list({ private: false });

			expect(Array.isArray(allProjects)).toBe(true);
			expect(Array.isArray(privateProjects)).toBe(true);
			expect(Array.isArray(publicProjects)).toBe(true);
		});

		test("should use find() method that returns null for missing projects", async () => {
			// Test the clean find interface
			const nonExistentProject = await testInstance.client.projects.find("non-existent-id");
			expect(nonExistentProject).toBeNull();
		});

		test("should support domain actions like archive/publish", async () => {
			// Create a project to test domain actions
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: "Test Domain Actions Project",
				visibility: "PRIVATE",
			});

			const project = await testInstance.createAndRegisterProject(projectData);
			expectValidProject(project);

			// Test publish action
			const publishedProject = await testInstance.client.projects.publish(project.id);
			expectValidProject(publishedProject);
			expect(publishedProject.visibility).toBe("PUBLIC");

			// Test archive action
			const archivedProject = await testInstance.client.projects.archive(project.id);
			expectValidProject(archivedProject);
			expect(archivedProject.visibility).toBe("ARCHIVED");

			// Test make_private action
			const privateProject = await testInstance.client.projects.make_private(project.id);
			expectValidProject(privateProject);
			expect(privateProject.visibility).toBe("PRIVATE");
		});
	});

	describe("Auth", () => {
		test("should use nested resources for keys", async () => {
			// Test that the nested keys resource is available
			expect(testInstance.client.auth.keys).toBeDefined();
			expect(typeof testInstance.client.auth.keys.create).toBe("function");
			expect(typeof testInstance.client.auth.keys.revoke).toBe("function");
			expect(typeof testInstance.client.auth.keys.remove).toBe("function");
		});

		test("should support clean session method", async () => {
			// Test the clean session interface
			expect(typeof testInstance.client.auth.session).toBe("function");
		});
	});

	describe("Tasks", () => {
		test("should support clean find() method", async () => {
			// Test the clean find interface
			const nonExistentTask = await testInstance.client.tasks.find("non-existent-id");
			expect(nonExistentTask).toBeNull();
		});

		test("should support domain actions like complete/start/archive", async () => {
			// Create a task to test domain actions
			const taskData = {
				title: "Test Domain Actions Task",
				progress: "UNSTARTED" as const,
				visibility: "PRIVATE" as const,
				priority: "MEDIUM" as const,
				owner_id: TEST_USER_ID,
			};

			const task = await testInstance.createAndRegisterTask(taskData);
			expect(task.task.progress).toBe("UNSTARTED");

			// Test start action
			const startedTask = await testInstance.client.tasks.start(task.task.id);
			expect(startedTask.task.progress).toBe("IN_PROGRESS");

			// Test complete action
			const completedTask = await testInstance.client.tasks.complete(task.task.id);
			expect(completedTask.task.progress).toBe("COMPLETED");
		});

		test("should support clean save_tags alias", async () => {
			// Test that the clean save_tags method exists
			expect(typeof testInstance.client.tasks.save_tags).toBe("function");
		});
	});
});
