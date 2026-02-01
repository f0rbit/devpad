import type { TaskWithDetails, UpdateData, UpsertTag, UpsertTodo } from "@devpad/schema";
import type { ActionType } from "@devpad/schema/database";
import { action, codebase_tasks, task, task_tag } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ServiceError } from "./errors.js";
import { doesUserOwnProject } from "./projects.js";
import { getTaskTags, upsertTag } from "./tags.js";

export type Task = TaskWithDetails;

async function fetchTasksWithDetails(db: Database, where_conditions: any[]): Promise<Result<Task[], ServiceError>> {
	const fetched_tasks = await db
		.select()
		.from(task)
		.leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id))
		.where(and(...where_conditions));

	const tasks: Task[] = fetched_tasks.map((t: any) => {
		const new_task: Task = t as any;
		new_task.tags = [];
		return new_task;
	});

	const task_ids = tasks.map(t => t.task.id);
	if (task_ids.length > 0) {
		const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));

		const mapped_tags = new Map<string, string[]>();
		for (const t of tags) {
			const existing = mapped_tags.get(t.task_id) ?? [];
			existing.push(t.tag_id);
			mapped_tags.set(t.task_id, existing);
		}

		for (const t of tasks) {
			t.tags = mapped_tags.get(t.task.id) ?? [];
		}
	}

	return ok(tasks);
}

export async function getUserTasks(db: Database, user_id: string): Promise<Result<Task[], ServiceError>> {
	return fetchTasksWithDetails(db, [eq(task.owner_id, user_id)]);
}

export async function getProjectTasks(db: Database, project_id: string): Promise<Result<Task[], ServiceError>> {
	return fetchTasksWithDetails(db, [eq(task.project_id, project_id)]);
}

export async function getTasksByTag(db: Database, tag_id: string): Promise<Result<Task[], ServiceError>> {
	const task_tag_relations = await db.select({ task_id: task_tag.task_id }).from(task_tag).where(eq(task_tag.tag_id, tag_id));
	const task_ids = task_tag_relations.map((rel: any) => rel.task_id as string);

	if (task_ids.length === 0) return ok([]);
	return fetchTasksWithDetails(db, [inArray(task.id, task_ids)]);
}

export async function getTask(db: Database, task_id: string): Promise<Result<Task | null, ServiceError>> {
	const tasks_result = await fetchTasksWithDetails(db, [eq(task.id, task_id)]);
	if (!tasks_result.ok) return tasks_result;
	return ok(tasks_result.value[0] || null);
}

export async function addTaskAction(
	db: Database,
	{ owner_id, task_id, type, description, project_id }: { owner_id: string; task_id: string; type: ActionType; description: string; project_id: string | null }
): Promise<Result<boolean, ServiceError>> {
	if (project_id) {
		const owns_result = await doesUserOwnProject(db, owner_id, project_id);
		if (!owns_result.ok) return owns_result;
		if (!owns_result.value) return ok(false);
	}

	const task_result = await getTask(db, task_id);
	if (!task_result.ok) return task_result;
	if (!task_result.value) return ok(false);

	const data = {
		task_id,
		project_id: project_id ?? undefined,
		title: task_result.value.task.title,
	};

	await db.insert(action).values({
		owner_id,
		type,
		description,
		data: JSON.stringify(data),
	});
	return ok(true);
}

export async function getUpsertedTaskMap(db: Database, codebase_items: UpdateData[]): Promise<Result<Map<string, string>, ServiceError>> {
	const result = new Map<string, string>();
	if (codebase_items.length === 0) return ok(result);

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

	return ok(result);
}

async function upsertTaskTags(db: Database, task_id: string, tags: string[]): Promise<void> {
	const current_result = await getTaskTags(db, task_id);
	const current = current_result.ok ? current_result.value.map(c => c.id) : [];

	const create = tags.filter(tag_id => !current.includes(tag_id));
	const delete_tags = current.filter(id => !tags.includes(id));

	if (delete_tags.length > 0) {
		await db.delete(task_tag).where(and(eq(task_tag.task_id, task_id), inArray(task_tag.tag_id, delete_tags)));
	}

	if (create.length > 0) {
		const insert_tags = create.map(t => ({ task_id, tag_id: t }));
		await db.insert(task_tag).values(insert_tags);
	}

	await db.update(task_tag).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task_tag.task_id, task_id));
}

export async function upsertTask(db: Database, data: UpsertTodo, tags: UpsertTag[], owner_id: string): Promise<Result<Task | null, ServiceError>> {
	const previous_result = data.id ? await getTask(db, data.id) : null;
	const previous = previous_result?.ok ? (previous_result.value?.task ?? null) : null;

	if (data.owner_id && data.owner_id !== owner_id) {
		return err({ kind: "forbidden", reason: "owner_id mismatch" });
	}

	if (previous && previous.owner_id !== owner_id) {
		return err({ kind: "forbidden", reason: "User does not own this task" });
	}

	if (data.goal_id) {
		const { getGoal } = await import("./goals.js");
		const goal_result = await getGoal(db, data.goal_id);
		if (!goal_result.ok || !goal_result.value) {
			return err({ kind: "bad_request", message: `Goal with id ${data.goal_id} does not exist` });
		}

		const task_project_id = data.project_id ?? previous?.project_id;
		const { getMilestone } = await import("./milestones.js");
		const milestone_result = await getMilestone(db, goal_result.value.milestone_id);
		if (!milestone_result.ok || !milestone_result.value) {
			return err({ kind: "bad_request", message: `Milestone for goal ${data.goal_id} does not exist` });
		}
		if (milestone_result.value.project_id !== task_project_id) {
			return err({ kind: "bad_request", message: `Goal ${data.goal_id} belongs to different project than task` });
		}
	}

	let tag_ids: string[] = [];
	if (tags && tags.length > 0) {
		const results = await Promise.all(tags.map(t => upsertTag(db, t)));
		const failed = results.find(r => !r.ok);
		if (failed && !failed.ok) return err(failed.error);
		tag_ids = results.filter(r => r.ok).map(r => r.value);
	}

	const exists = !!previous;
	const project_id = data.project_id ?? previous?.project_id ?? null;

	const upsert = {
		...data,
		updated_at: new Date().toISOString(),
		owner_id,
	};
	if (upsert.id === "" || upsert.id == null) delete upsert.id;

	let result: Task["task"] | null = null;
	if (exists && upsert.id) {
		const update_result = await db
			.update(task)
			.set(upsert as any)
			.where(eq(task.id, upsert.id))
			.returning();
		result = update_result[0] || null;
	} else {
		const insert_result = await db
			.insert(task)
			.values(upsert as any)
			.onConflictDoUpdate({ target: [task.id], set: upsert as any })
			.returning();
		result = insert_result[0] || null;
	}

	if (!result) return err({ kind: "db_error", message: "Task upsert failed" });

	const new_todo = result;
	const fresh_complete = data.progress === "COMPLETED" && previous?.progress !== "COMPLETED";

	const action_type: ActionType = !exists ? "CREATE_TASK" : "UPDATE_TASK";
	const action_desc = !exists ? "Created task" : fresh_complete ? "Completed task" : "Updated task";

	await addTaskAction(db, { owner_id, task_id: new_todo.id, type: action_type, description: action_desc, project_id });

	if (tag_ids.length > 0) {
		await upsertTaskTags(db, new_todo.id, tag_ids);
	}

	return getTask(db, new_todo.id);
}
