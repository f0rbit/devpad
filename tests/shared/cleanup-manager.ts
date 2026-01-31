import type ApiClient from "@devpad/api";
import type { Project, Tag, TaskWithDetails } from "@devpad/schema";
import { log } from "./test-utils";

type CleanupFunction = () => Promise<void>;

/**
 * Manages cleanup of test resources to prevent test pollution
 * Tracks created resources and cleans them up after tests
 */
export class CleanupManager {
	private client: ApiClient;
	private cleanup_functions: Map<string, CleanupFunction[]>;

	constructor(client: ApiClient) {
		this.client = client;
		this.cleanup_functions = new Map<string, CleanupFunction[]>();
	}

	/**
	 * Register a generic cleanup function
	 */
	registerCleanup(key: string, cleanup_fn: CleanupFunction): void {
		const existing = this.cleanup_functions.get(key) || [];
		existing.push(cleanup_fn);
		this.cleanup_functions.set(key, existing);
	}

	/**
	 * Register a project for cleanup
	 */
	registerProject(project: Project): void {
		this.registerCleanup("projects", async () => {
			try {
				const result = await this.client.projects.update(project.id, { deleted: true });
				if (!result.ok) {
					log(`⚠️ Failed to cleanup project ${project.id}: ${result.error.message}`);
				} else {
					log(`✅ Cleaned up project: ${project.name} (${project.id})`);
				}
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
				const result = await this.client.tasks.deleteTask(task);
				if (!result.ok) {
					log(`⚠️ Failed to cleanup task ${task.task.id}: ${result.error.message}`);
				} else {
					log(`✅ Cleaned up task: ${task.task.title} (${task.task.id})`);
				}
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
		const cleanup_order = ["tasks", "tags", "projects"];

		for (const key of cleanup_order) {
			const cleanup_fns = this.cleanup_functions.get(key) || [];
			if (cleanup_fns.length > 0) {
				log(`🧹 Cleaning up ${cleanup_fns.length} ${key}...`);
				await Promise.all(cleanup_fns.map(fn => fn()));
			}
		}

		// Clean up any other registered functions
		for (const [key, cleanup_fns] of this.cleanup_functions.entries()) {
			if (!cleanup_order.includes(key)) {
				log(`🧹 Cleaning up ${cleanup_fns.length} ${key}...`);
				await Promise.all(cleanup_fns.map(fn => fn()));
			}
		}

		// Clear all registered cleanup functions
		this.cleanup_functions.clear();
		log("✅ Cleanup completed");
	}

	/**
	 * Get count of registered resources for debugging
	 */
	getResourceCounts(): Record<string, number> {
		const counts: Record<string, number> = {};
		for (const [key, functions] of this.cleanup_functions.entries()) {
			counts[key] = functions.length;
		}
		return counts;
	}
}
