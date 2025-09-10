import type { UpdateData, UpsertTodo, UpsertTag, TaskWithDetails } from "@devpad/schema";
import { type ActionType, codebase_tasks, db, task, task_tag, action } from "@devpad/schema/database/server";
import { and, eq, inArray, sql } from "drizzle-orm";

// Use the TaskWithDetails type from schema instead of our own definition
export type Task = TaskWithDetails;

/**
 * Private helper to fetch tasks with tags and codebase info
 */
async function fetchTasksWithDetails(whereConditions: any[]): Promise<Task[]> {
	try {
		// Fetch tasks with left join on codebase_tasks
		const fetched_tasks = await db
			.select()
			.from(task)
			.leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id))
			.where(and(...whereConditions));

		// Initialize tasks with empty tags array
		const tasks = fetched_tasks.map(t => {
			const new_task: Task = t as any;
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
		return [];
	}
}

export async function getUserTasks(user_id: string): Promise<Task[]> {
	return fetchTasksWithDetails([eq(task.owner_id, user_id)]);
}

export async function getProjectTasks(project_id: string): Promise<Task[]> {
	return fetchTasksWithDetails([eq(task.project_id, project_id)]);
}

export async function getTasksByTag(tag_id: string): Promise<Task[]> {
	try {
		// First get tasks that have this tag
		const task_tag_relations = await db.select({ task_id: task_tag.task_id }).from(task_tag).where(eq(task_tag.tag_id, tag_id));
		const task_ids = task_tag_relations.map(rel => rel.task_id);

		if (task_ids.length === 0) return [];

		return fetchTasksWithDetails([inArray(task.id, task_ids)]);
	} catch (error) {
		return [];
	}
}

export async function getTask(task_id: string): Promise<Task | null> {
	try {
		const tasks = await fetchTasksWithDetails([eq(task.id, task_id)]);
		return tasks[0] || null;
	} catch (error) {
		return null;
	}
}

export async function addTaskAction({ owner_id, task_id, type, description, project_id }: { owner_id: string; task_id: string; type: ActionType; description: string; project_id: string | null }): Promise<boolean> {
	try {
		const data = { task_id: task_id } as { task_id: string; project_id?: string; title?: string };

		if (project_id) {
			// Check if user owns the project (if provided)
			const { doesUserOwnProject } = await import("./projects");
			const user_owns = await doesUserOwnProject(owner_id, project_id);
			if (!user_owns) return false;
			data.project_id = project_id;
		}

		const task_record = await getTask(task_id);
		if (!task_record) return false;

		// Attach title to the data
		data.title = task_record.task.title;

		await db.insert(action).values({
			owner_id,
			type,
			description,
			data: JSON.stringify(data),
		});
		return true;
	} catch (error) {
		return false;
	}
}

export async function getUpsertedTaskMap(codebase_items: UpdateData[]): Promise<Map<string, string>> {
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
		// Silent error handling
	}

	return result;
}

async function upsertTaskTags(task_id: string, tags: string[]): Promise<void> {
	try {
		const { getTaskTags } = await import("./tags");
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
		// Silent error handling
	}
}

export async function upsertTask(data: UpsertTodo, tags: UpsertTag[], owner_id: string): Promise<Task | null> {
	const previous = await (async () => {
		if (!data.id) return null;
		return (await getTask(data.id))?.task ?? null;
	})();

	// Ensure owner_id matches
	if (data.owner_id && data.owner_id !== owner_id) {
		throw new Error("Unauthorized: owner_id mismatch");
	}

	// Authorize existing task
	if (previous && previous.owner_id !== owner_id) {
		throw new Error("Unauthorized: User does not own this task");
	}

	// Validate goal_id if provided
	if (data.goal_id) {
		const { getGoal } = await import("./goals");
		const { goal, error } = await getGoal(data.goal_id);
		if (error || !goal) {
			throw new Error(`Goal with id ${data.goal_id} does not exist`);
		}
		// Ensure goal belongs to the same project
		const task_project_id = data.project_id ?? previous?.project_id;
		// Get milestone to resolve project_id (goals belong to milestones)
		const { getMilestone } = await import("./milestones");
		const { milestone, error: milestoneError } = await getMilestone(goal.milestone_id);
		if (milestoneError || !milestone) {
			throw new Error(`Milestone for goal ${data.goal_id} does not exist`);
		}
		if (milestone.project_id !== task_project_id) {
			throw new Error(`Goal ${data.goal_id} belongs to project ${milestone.project_id}, but task belongs to project ${task_project_id}`);
		}
	}

	let tag_ids: string[] = [];

	if (tags && tags.length > 0) {
		const { upsertTag } = await import("./tags");
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

	let result: Task["task"] | null = null;
	if (exists && upsert.id) {
		// Perform update
		const updateResult = await db
			.update(task)
			.set(upsert as any)
			.where(eq(task.id, upsert.id))
			.returning();
		result = updateResult[0] || null;
	} else {
		// Perform insert
		try {
			const res = await db
				.insert(task)
				.values(upsert as any)
				.onConflictDoUpdate({ target: [task.id], set: upsert as any })
				.returning();
			result = res[0] || null;
		} catch (error) {
			throw error;
		}
	}

	if (!result) throw new Error("Task upsert failed");

	const new_todo = result;
	const fresh_complete = data.progress === "COMPLETED" && previous?.progress !== "COMPLETED";

	// Add action logs
	if (!exists) {
		await addTaskAction({ owner_id, task_id: new_todo.id, type: "CREATE_TASK", description: "Created task", project_id });
	} else if (fresh_complete) {
		await addTaskAction({ owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Completed task", project_id });
	} else {
		await addTaskAction({ owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Updated task", project_id });
	}

	// Link each tag to every task
	if (tag_ids.length > 0) {
		await upsertTaskTags(new_todo.id, tag_ids);
	}

	return getTask(new_todo.id);
}
