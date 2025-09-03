import type { TaskWithDetails, UpsertTag, UpsertTodo } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

/**
 * Clean, standardized Tasks API client
 * Follows consistent CRUD patterns
 */
export class TasksClient extends BaseClient {
	/**
	 * List tasks with optional filtering
	 */
	async list(filters?: { project_id?: string; tag_id?: string }): Promise<TaskWithDetails[]> {
		return this.listWith<TaskWithDetails[]>("/tasks", {
			project: filters?.project_id,
			tag: filters?.tag_id,
		});
	}

	/**
	 * Get task by ID
	 */
	async find(id: string): Promise<TaskWithDetails | null> {
		try {
			return await this.getBy<TaskWithDetails>("/tasks", "id", id);
		} catch (error) {
			// If 404, return null instead of throwing
			return null;
		}
	}

	/**
	 * Create a new task
	 */
	async create(data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }): Promise<TaskWithDetails> {
		return this.upsertEntity<TaskWithDetails, typeof data>("/tasks", data);
	}

	/**
	 * Update an existing task
	 */
	async update(id: string, changes: Partial<Omit<UpsertTodo, "id">> & { tags?: UpsertTag[] }): Promise<TaskWithDetails> {
		// Fetch existing task to merge changes
		const existing = await this.find(id);
		if (!existing) {
			throw new Error(`Task with id ${id} not found`);
		}

		const updateData = {
			id,
			title: existing.task.title,
			summary: existing.task.summary,
			description: existing.task.description,
			progress: existing.task.progress,
			visibility: existing.task.visibility,
			start_time: existing.task.start_time,
			end_time: existing.task.end_time,
			priority: existing.task.priority,
			owner_id: existing.task.owner_id,
			project_id: existing.task.project_id,
			...changes,
		};

		return this.upsertEntity<TaskWithDetails, typeof updateData>("/tasks", updateData);
	}

	/**
	 * Delete a task (soft delete via visibility)
	 */
	async remove(id: string): Promise<void> {
		await this.update(id, { visibility: "DELETED" });
	}

	/**
	 * Mark task as completed
	 */
	async complete(id: string): Promise<TaskWithDetails> {
		return this.update(id, { progress: "COMPLETED" });
	}

	/**
	 * Start a task (mark as in progress)
	 */
	async start(id: string): Promise<TaskWithDetails> {
		return this.update(id, { progress: "IN_PROGRESS" });
	}

	/**
	 * Archive a task
	 */
	async archive(id: string): Promise<TaskWithDetails> {
		return this.update(id, { visibility: "ARCHIVED" });
	}

	/**
	 * Save tags (clean method)
	 */
	async save_tags(tags: UpsertTag[]): Promise<UpsertTag[]> {
		return this.patch<UpsertTag[]>("/tasks/save_tags", {
			body: tags,
		});
	}

	// === BACKWARD COMPATIBILITY METHODS ===

	async getById(id: string) {
		const task = await this.find(id);
		if (!task) throw new Error(`Task with id ${id} not found`);
		return task;
	}

	async getByProject(project_id: string) {
		return this.getBy<TaskWithDetails[]>("/tasks", "project", project_id);
	}

	async getByTag(tag_id: string) {
		return this.getBy<TaskWithDetails[]>("/tasks", "tag", tag_id);
	}

	async upsert(data: UpsertTodo & { tags?: UpsertTag[] }) {
		return this.upsertEntity<TaskWithDetails, typeof data>("/tasks", data);
	}

	async deleteTask(task: TaskWithDetails) {
		return this.upsertEntity<TaskWithDetails, any>("/tasks", {
			...task.task,
			visibility: "DELETED",
		});
	}

	async saveTags(tags: UpsertTag[]): Promise<UpsertTag[]> {
		return this.save_tags(tags);
	}
}
