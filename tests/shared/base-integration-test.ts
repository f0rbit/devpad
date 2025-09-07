import { afterAll, beforeAll } from "bun:test";
import type ApiClient from "@devpad/api";
import type { Project, TaskWithDetails, Tag } from "@devpad/schema";
import { getSharedApiClient } from "../integration/setup";
import { CleanupManager } from "./cleanup-manager";
import { log } from "./test-utils";

/**
 * Base class for integration tests providing common functionality
 * Handles test client setup, cleanup management, and helper methods
 * Now uses the shared global server instance
 */
export abstract class BaseIntegrationTest {
	protected cleanupManager!: CleanupManager;

	// These will be initialized by setupBaseIntegrationTest
	public client!: ApiClient;
	protected cleanup!: CleanupManager;

	/**
	 * Setup test environment - now uses shared client
	 */
	public async setupTest(): Promise<void> {
		log(`🧪 Setting up integration test: ${this.constructor.name}`);
		this.client = getSharedApiClient();
		this.cleanup = new CleanupManager(this.client);
		log(`✅ Test setup completed for: ${this.constructor.name}`);
	}

	/**
	 * Cleanup test resources - only cleans up test data, not server
	 */
	public async teardownTest(): Promise<void> {
		log(`🧹 Tearing down integration test: ${this.constructor.name}`);

		// Clean up all registered resources (projects, tasks, etc.)
		await this.cleanup.cleanupAll();

		// Note: Server cleanup is handled globally, not per test file

		log(`✅ Test teardown completed for: ${this.constructor.name}`);
	}

	/**
	 * Register a project for automatic cleanup
	 */
	public registerProject(project: Project): void {
		this.cleanup.registerProject(project);
	}

	/**
	 * Register a task for automatic cleanup
	 */
	public registerTask(task: TaskWithDetails): void {
		this.cleanup.registerTask(task);
	}

	/**
	 * Register a tag for automatic cleanup
	 */
	public registerTag(tag: Tag): void {
		this.cleanup.registerTag(tag);
	}

	/**
	 * Get resource counts for debugging
	 */
	public getResourceCounts(): Record<string, number> {
		return this.cleanup.getResourceCounts();
	}

	/**
	 * Create a project and automatically register it for cleanup
	 */
	public async createAndRegisterProject(project_data: any): Promise<Project> {
		const { project, error } = await this.client.projects.create(project_data);
		if (error) {
			throw new Error(`Failed to create project: ${error.message}`);
		}
		this.registerProject(project!);
		log(`📋 Created and registered project: ${project!.name} (${project!.id})`);
		return project!;
	}

	/**
	 * Create a task and automatically register it for cleanup
	 */
	public async createAndRegisterTask(task_data: any): Promise<TaskWithDetails> {
		const { task, error } = await this.client.tasks.create(task_data);
		if (error) {
			throw new Error(`Failed to create task: ${error.message}`);
		}
		this.registerTask(task!);
		log(`✅ Created and registered task: ${task!.task.title} (${task!.task.id})`);
		return task!;
	}

	/**
	 * Manual cleanup of specific resource (useful for testing delete operations)
	 */
	protected async manualCleanupProject(project: Project): Promise<void> {
		try {
			const { error } = await this.client.projects.deleteProject(project);
			if (error) {
				throw new Error(`Failed to delete project: ${error.message}`);
			}
			log(`🗑️ Manually cleaned up project: ${project.name} (${project.id})`);
		} catch (error) {
			log(`⚠️ Failed to manually cleanup project ${project.id}:`, error);
		}
	}

	/**
	 * Manual cleanup of specific task
	 */
	protected async manualCleanupTask(task: TaskWithDetails): Promise<void> {
		try {
			const { error } = await this.client.tasks.deleteTask(task);
			if (error) {
				throw new Error(`Failed to delete task: ${error.message}`);
			}
			log(`🗑️ Manually cleaned up task: ${task.task.title} (${task.task.id})`);
		} catch (error) {
			log(`⚠️ Failed to manually cleanup task ${task.task.id}:`, error);
		}
	}
}

/**
 * Helper function to create a standard integration test setup
 * Usage:
 *
 * class MyIntegrationTest extends BaseIntegrationTest {
 *   // Test methods here
 * }
 *
 * const test_instance = new MyIntegrationTest();
 * setupBaseIntegrationTest(test_instance);
 *
 * describe("My Integration Tests", () => {
 *   // Your tests here
 * });
 */
export function setupBaseIntegrationTest(test_instance: BaseIntegrationTest): void {
	beforeAll(async () => {
		await (test_instance as any).setupTest();
	});

	afterAll(async () => {
		await (test_instance as any).teardownTest();
	});
}
