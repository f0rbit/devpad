import { afterAll, beforeAll } from "bun:test";
import type ApiClient from "@devpad/api";
import type { Project, TaskWithDetails, Tag } from "@devpad/schema";
import { setupIntegrationTests, teardownIntegrationTests } from "../integration/setup";
import { CleanupManager } from "./cleanup-manager";
import { log } from "./test-utils";
import { TestDataFactory } from "../integration/factories";

/**
 * Base class for integration tests providing common functionality
 * Handles test client setup, cleanup management, and helper methods
 */
export abstract class BaseIntegrationTest {
	protected cleanupManager!: CleanupManager;

	// These will be initialized by setupBaseIntegrationTest
	public client!: ApiClient;
	protected cleanup!: CleanupManager;

	/**
	 * Setup test environment - call this in beforeAll
	 */
	public async setupTest(): Promise<void> {
		log(`🧪 Setting up integration test: ${this.constructor.name}`);
		this.client = await setupIntegrationTests();
		this.cleanup = new CleanupManager(this.client);
		log(`✅ Test setup completed for: ${this.constructor.name}`);
	}

	/**
	 * Cleanup test resources - call this in afterAll
	 */
	public async teardownTest(): Promise<void> {
		log(`🧹 Tearing down integration test: ${this.constructor.name}`);

		// Clean up all registered resources
		await this.cleanup.cleanupAll();

		// Shutdown the test server
		await teardownIntegrationTests();

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
	public async createAndRegisterProject(projectData: any): Promise<Project> {
		const project = await this.client.projects.create(projectData);
		this.registerProject(project);
		log(`📋 Created and registered project: ${project.name} (${project.id})`);
		return project;
	}

	/**
	 * Create a task and automatically register it for cleanup
	 */
	public async createAndRegisterTask(taskData: any): Promise<TaskWithDetails> {
		const task = await this.client.tasks.create(taskData);
		this.registerTask(task);
		log(`✅ Created and registered task: ${task.task.title} (${task.task.id})`);
		return task;
	}

	/**
	 * Manual cleanup of specific resource (useful for testing delete operations)
	 */
	protected async manualCleanupProject(project: Project): Promise<void> {
		try {
			await this.client.projects.deleteProject(project);
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
			await this.client.tasks.deleteTask(task);
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
 * const testInstance = new MyIntegrationTest();
 * setupBaseIntegrationTest(testInstance);
 *
 * describe("My Integration Tests", () => {
 *   // Your tests here
 * });
 */
export function setupBaseIntegrationTest(testInstance: BaseIntegrationTest): void {
	beforeAll(async () => {
		await (testInstance as any).setupTest();
	});

	afterAll(async () => {
		await (testInstance as any).teardownTest();
	});
}
