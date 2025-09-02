import type { UpdateData } from "@devpad/schema";
import { type ActionType, codebase_tasks, db, task, task_tag } from "@devpad/schema/database";
import { and, eq, inArray, sql } from "drizzle-orm";
import { BaseRepository } from "./base-repository";

export type _FetchedTask = typeof task.$inferSelect;
export type _FetchedCodebaseTask = typeof codebase_tasks.$inferSelect;
export type _FetchTaskUnion = { task: _FetchedTask; codebase_tasks: _FetchedCodebaseTask | null; tags: string[] };
export type Task = _FetchTaskUnion;

export class TaskRepository extends BaseRepository<typeof task, _FetchedTask, any> {
	constructor() {
		super(task);
	}

	/**
	 * Private helper to fetch tasks with tags and codebase info
	 */
	private async fetchTasksWithDetails(whereConditions: any[]): Promise<Task[]> {
		try {
			// Fetch tasks with left join on codebase_tasks
			const fetched_tasks = await db
				.select()
				.from(task)
				.leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id))
				.where(and(...whereConditions));

			// Initialize tasks with empty tags array
			const tasks = fetched_tasks.map(t => {
				const new_task: _FetchTaskUnion = t as any;
				new_task.tags = [];
				return new_task;
			});

			// Get all tags for each task
			const task_ids = tasks.map(t => t.task.id);
			if (task_ids.length > 0) {
				const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));

				// Build a map of task_id -> array of tag_ids
				const mapped_tags = new Map<string, string[]>();
				tags.forEach(tag => {
					const task_id = tag.task_id;
					if (!mapped_tags.has(task_id)) {
						mapped_tags.set(task_id, []);
					}
					mapped_tags.get(task_id)?.push(tag.tag_id);
				});

				// Apply tags to tasks
				for (const t of tasks) {
					t.tags = mapped_tags.get(t.task.id) ?? [];
				}
			}

			return tasks;
		} catch (error) {
			console.error("Error fetching tasks with details:", error);
			return [];
		}
	}

	async getUserTasks(user_id: string): Promise<Task[]> {
		return this.fetchTasksWithDetails([eq(task.owner_id, user_id)]);
	}

	async getProjectTasks(project_id: string): Promise<Task[]> {
		return this.fetchTasksWithDetails([eq(task.project_id, project_id)]);
	}

	async getTasksByTag(tag_id: string): Promise<Task[]> {
		try {
			// First get tasks that have this tag
			const task_tag_relations = await db.select({ task_id: task_tag.task_id }).from(task_tag).where(eq(task_tag.tag_id, tag_id));
			const task_ids = task_tag_relations.map(rel => rel.task_id);

			if (task_ids.length === 0) return [];

			return this.fetchTasksWithDetails([inArray(task.id, task_ids)]);
		} catch (error) {
			console.error("Error getting tasks by tag:", error);
			return [];
		}
	}

	async getTask(task_id: string): Promise<Task | null> {
		try {
			const tasks = await this.fetchTasksWithDetails([eq(task.id, task_id)]);
			return tasks[0] || null;
		} catch (error) {
			console.error("Error getting single task:", error);
			return null;
		}
	}

	async addTaskAction(actionData: { owner_id: string; task_id: string; type: ActionType; description: string; project_id: string | null }): Promise<boolean> {
		try {
			const data = { task_id: actionData.task_id } as { task_id: string; project_id?: string; title?: string };

			if (actionData.project_id) {
				// Check if user owns the project (if provided)
				const { doesUserOwnProject } = await import("../services/projects");
				const user_owns = await doesUserOwnProject(actionData.owner_id, actionData.project_id);
				if (!user_owns) return false;
				data.project_id = actionData.project_id;
			}

			const task_record = await this.getTask(actionData.task_id);
			if (!task_record) return false;

			// Attach title to the data
			data.title = task_record.task.title;

			return this.addAction({
				owner_id: actionData.owner_id,
				type: actionData.type,
				description: actionData.description,
				data,
			});
		} catch (error) {
			console.error("Error adding task action:", error);
			return false;
		}
	}

	async getUpsertedTaskMap(codebase_items: UpdateData[]): Promise<Map<string, string>> {
		const result = new Map<string, string>(); // codebase_tasks.id -> task.id

		if (codebase_items.length === 0) return result;

		try {
			const existing_tasks = await db
				.select()
				.from(task)
				.where(
					inArray(
						task.codebase_task_id,
						codebase_items.map(item => item.id)
					)
				);

			for (const t of existing_tasks) {
				if (t.codebase_task_id) {
					result.set(t.codebase_task_id, t.id);
				}
			}
		} catch (error) {
			console.error("Error getting upserted task map:", error);
		}

		return result;
	}

	async upsertTask(data: any, tags: any[], owner_id: string): Promise<Task | null> {
		const previous = await (async () => {
			if (!data.id) return null;
			return (await this.getTask(data.id))?.task ?? null;
		})();

		// Ensure owner_id matches
		if (data.owner_id && data.owner_id !== owner_id) {
			throw new Error("Unauthorized: owner_id mismatch");
		}

		// Authorize existing task
		if (previous && previous.owner_id !== owner_id) {
			throw new Error("Unauthorized: User does not own this task");
		}

		let tag_ids: string[] = [];

		if (tags && tags.length > 0) {
			const { upsertTag } = await import("../services/tags");
			// Update any of the tags
			const promises = tags.map(upsertTag);
			tag_ids = await Promise.all(promises);
		}

		const exists = !!previous;
		const project_id = data.project_id ?? previous?.project_id ?? null;

		// Prepare upsert data
		const upsert = {
			...data,
			updated_at: new Date().toISOString(),
			owner_id: owner_id, // Ensure owner_id is set correctly
		};
		if (upsert.id === "" || upsert.id == null) delete upsert.id;

		let result: _FetchedTask | null = null;
		if (exists && upsert.id) {
			// Perform update
			result = await this.updateById(upsert.id, upsert);
		} else {
			// Perform insert
			try {
				const res = await db
					.insert(task)
					.values(upsert)
					.onConflictDoUpdate({ target: [task.id], set: upsert })
					.returning();
				result = res[0] || null;
			} catch (error) {
				console.error("Error upserting task:", error);
				throw error;
			}
		}

		if (!result) throw new Error("Task upsert failed");

		const new_todo = result;
		const fresh_complete = data.progress === "COMPLETED" && previous?.progress !== "COMPLETED";

		// Add action logs
		if (!exists) {
			await this.addTaskAction({ owner_id, task_id: new_todo.id, type: "CREATE_TASK", description: "Created task", project_id });
		} else if (fresh_complete) {
			await this.addTaskAction({ owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Completed task", project_id });
		} else {
			await this.addTaskAction({ owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Updated task", project_id });
		}

		// Link each tag to every task
		if (tag_ids.length > 0) {
			await this.upsertTaskTags(new_todo.id, tag_ids);
		}

		return this.getTask(new_todo.id);
	}

	private async upsertTaskTags(task_id: string, tags: string[]): Promise<void> {
		try {
			const { getTaskTags } = await import("../services/tags");
			// Get the current tags on the task
			const current = (await getTaskTags(task_id)).map(c => c.id);

			// Split into [new, existing]
			const create = tags.filter(tag_id => !current.find(current_id => current_id === tag_id));

			// Delete any tags that are no longer in the list
			const delete_tags = current.filter(id => !tags.includes(id));

			if (delete_tags.length > 0) {
				await db.delete(task_tag).where(and(eq(task_tag.task_id, task_id), inArray(task_tag.tag_id, delete_tags)));
			}

			// Insert any new tags
			const insert_tags = create.map(t => ({ task_id: task_id, tag_id: t }));
			if (insert_tags.length > 0) {
				await db.insert(task_tag).values(insert_tags);
			}

			// Update the updated_at time on each link
			await db.update(task_tag).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task_tag.task_id, task_id));
		} catch (error) {
			console.error("Error upserting task tags:", error);
		}
	}
}

export const taskRepository = new TaskRepository();
