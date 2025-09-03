import type ApiClient from "@devpad/api";
import type { Project, TaskWithDetails, Tag } from "@devpad/schema";
import { log } from "./test-utils";

type CleanupFunction = () => Promise<void>;

/**
 * Manages cleanup of test resources to prevent test pollution
 * Tracks created resources and cleans them up after tests
 */
export class CleanupManager {
	private client: ApiClient;
	private cleanupFunctions: Map<string, CleanupFunction[]>;

	constructor(client: ApiClient) {
		this.client = client;
		this.cleanupFunctions = new Map<string, CleanupFunction[]>();
	}

	/**
	 * Register a generic cleanup function
	 */
	registerCleanup(key: string, cleanupFn: CleanupFunction): void {
		const existing = this.cleanupFunctions.get(key) || [];
		existing.push(cleanupFn);
		this.cleanupFunctions.set(key, existing);
	}

	/**
	 * Register a project for cleanup
	 */
	registerProject(project: Project): void {
		this.registerCleanup("projects", async () => {
			try {
				await this.client.projects.deleteProject(project);
				log(`✅ Cleaned up project: ${project.name} (${project.id})`);
			} catch (error) {
				log(`⚠️ Failed to cleanup project ${project.id}:`, error);
			}
		});
	}

	/**
	 * Register a task for cleanup
	 */
	registerTask(task: TaskWithDetails): void {
		this.registerCleanup("tasks", async () => {
			try {
				await this.client.tasks.deleteTask(task);
				log(`✅ Cleaned up task: ${task.task.title} (${task.task.id})`);
			} catch (error) {
				log(`⚠️ Failed to cleanup task ${task.task.id}:`, error);
			}
		});
	}

	/**
	 * Register a tag for cleanup (currently tags are managed through tasks)
	 */
	registerTag(tag: Tag): void {
		this.registerCleanup("tags", async () => {
			try {
				// TODO: Implement tag deletion when API is available
				log(`ℹ️ Tag cleanup not yet implemented: ${tag.title} (${tag.id})`);
			} catch (error) {
				log(`⚠️ Failed to cleanup tag ${tag.id}:`, error);
			}
		});
	}

	/**
	 * Run all cleanup functions, with proper ordering (tasks before projects)
	 */
	async cleanupAll(): Promise<void> {
		log("🧹 Starting cleanup of all test resources...");

		// Clean up in reverse dependency order: tasks -> tags -> projects
		const cleanupOrder = ["tasks", "tags", "projects"];

		for (const key of cleanupOrder) {
			const cleanupFns = this.cleanupFunctions.get(key) || [];
			if (cleanupFns.length > 0) {
				log(`🧹 Cleaning up ${cleanupFns.length} ${key}...`);
				await Promise.all(cleanupFns.map(fn => fn()));
			}
		}

		// Clean up any other registered functions
		for (const [key, cleanupFns] of this.cleanupFunctions.entries()) {
			if (!cleanupOrder.includes(key)) {
				log(`🧹 Cleaning up ${cleanupFns.length} ${key}...`);
				await Promise.all(cleanupFns.map(fn => fn()));
			}
		}

		// Clear all registered cleanup functions
		this.cleanupFunctions.clear();
		log("✅ Cleanup completed");
	}

	/**
	 * Get count of registered resources for debugging
	 */
	getResourceCounts(): Record<string, number> {
		const counts: Record<string, number> = {};
		for (const [key, functions] of this.cleanupFunctions.entries()) {
			counts[key] = functions.length;
		}
		return counts;
	}
}
