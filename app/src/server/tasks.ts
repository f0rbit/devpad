import { and, eq, inArray } from "drizzle-orm";
import { action, codebase_tasks, task, task_tag, type ActionType } from "@/database/schema";
import { db } from "@/database/db";
import { doesUserOwnProject } from "./projects";
import type { UpdateData } from "./types";

export async function getUserTasks(user_id: string) {
	// pull from tasks, there are a couple things we will need to fetch as well
	// task could have multiple tags & checklists

	// fetch tasks left joining codebase on codebase_task_id
	const fetched_tasks = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.owner_id, user_id));
	// append .tags = [] to each task
	const tasks = fetched_tasks.map((t) => {
		const new_task: _FetchTaskUnion = t as any;
		new_task.tags = [];
		return new_task;
	});

	// get all tags for each task
	const task_ids = tasks.map((t) => t.task.id);

	if (task_ids.length > 0) {
		const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));
		// construct a Map of task_id -> array of tag_ids
		const mapped_tags = new Map<string, string[]>();
		tags.forEach((tag) => {
			const task_id = tag.task_id;
			if (!mapped_tags.has(task_id)) {
				mapped_tags.set(task_id, []);
			}
			mapped_tags.get(task_id)!.push(tag.tag_id);
		});

		for (const t of tasks) {
			t.tags = mapped_tags.get(t.task.id) ?? [];
		}
	}

	return tasks;
}

export type _FetchedTask = typeof task.$inferSelect;
export type _FetchedCodebaseTask = typeof codebase_tasks.$inferSelect;
type _FetchTaskUnion = { task: _FetchedTask; codebase_tasks: _FetchedCodebaseTask; tags: string[] };

export type Task = Awaited<ReturnType<typeof getUserTasks>>[0];

export async function getProjectTasks(project_id: string) {
	const fetched_tasks = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.project_id, project_id));
	// append .tags = [] to each task
	const tasks = fetched_tasks.map((t) => {
		const new_task: _FetchTaskUnion = t as any;
		new_task.tags = [];
		return new_task;
	});

	// get all tags for each task
	const task_ids = tasks.map((t) => t.task.id);
	if (task_ids.length) {
		const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));
		// construct a Map of task_id -> array of tag_ids
		const mapped_tags = new Map<string, string[]>();
		tags.forEach((tag) => {
			const task_id = tag.task_id;
			if (!mapped_tags.has(task_id)) {
				mapped_tags.set(task_id, []);
			}
			mapped_tags.get(task_id)!.push(tag.tag_id);
		});

		for (const t of tasks) {
			t.tags = mapped_tags.get(t.task.id) ?? [];
		}
	}

	return tasks;
}

export type TagLink = { task_id: string; tag_id: string; updated_at: string; created_at: string };

export async function getTask(todo_id: string) {
	const todo = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.id, todo_id));
	if (!todo || todo.length != 1) {
		return null;
	}
	const found = todo[0] as _FetchTaskUnion;

	const tags = await db.select().from(task_tag).where(eq(task_tag.task_id, found.task.id));
	found.tags = tags?.map((t) => t.tag_id) ?? [];

	return found;
}

export async function addTaskAction({
	owner_id,
	task_id,
	type,
	description,
	project_id,
}: {
	owner_id: string;
	task_id: string;
	type: ActionType;
	description: string;
	project_id: string | null;
}) {
	// if project_id is null, don't write anything to the data field
	const data = { task_id } as { task_id: string; project_id?: string; title?: string };
	if (project_id) {
		const user_owns = await doesUserOwnProject(owner_id, project_id);
		if (!user_owns) return false;
		data.project_id = project_id;
	}

	const task = await getTask(task_id);
	if (!task) return false;

	// attach title to the data
	data.title = task.task.title;

	// add the action
	await db.insert(action).values({ owner_id, type, description, data });

	console.log("inserted action", type);

	return true;
}

export async function getUpsertedTaskMap(codebase_items: UpdateData[]) {
	// for every item we want to make sure we have a task associated with it,
	// if not, then we can create one. when creating, we can use the titles map to get the title, otherwise use item.data.new.text
	const result = new Map<string, string>(); // codebase_tasks.id -> task.id

	const existing_tasks = await db
		.select()
		.from(task)
		.where(
			inArray(
				task.codebase_task_id,
				codebase_items.map((item) => item.id),
			),
		);

	for (const t of existing_tasks) {
		result.set(t.codebase_task_id!, t.id);
	}

	return result;
}

export async function getTasksByTag(tag_id: string) {
	const tasks = await db
		.select()
		.from(task)
		.leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id))
		.leftJoin(task_tag, eq(task_tag.task_id, task.id))
		.where(eq(task_tag.tag_id, tag_id));
	// append .tags = [] to each task
	const found_tasks = tasks.map((t) => {
		const new_task: _FetchTaskUnion = t as any;
		new_task.tags = [];
		return new_task;
	});

	// get all tags for each task
	const task_ids = found_tasks.map((t) => t.task.id);
	if (task_ids.length) {
		const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));
		// construct a Map of task_id -> array of tag_ids
		const mapped_tags = new Map<string, string[]>();
		tags.forEach((tag) => {
			const task_id = tag.task_id;
			if (!mapped_tags.has(task_id)) {
				mapped_tags.set(task_id, []);
			}
			mapped_tags.get(task_id)!.push(tag.tag_id);
			console.log("tag", tag);
		});

		for (const t of found_tasks) {
			t.tags = mapped_tags.get(t.task.id) ?? [];
		}
	}

	return found_tasks;
}

export async function upsertTask(data: any, tags: any[], owner_id: string) {
	const previous = await (async () => {
		if (!data.id) return null;
		return (await getTask(data.id))?.task ?? null;
	})();

	// ensure owner_id matches
	if (data.owner_id && data.owner_id !== owner_id) {
		throw new Error("Unauthorized: owner_id mismatch");
	}

	// authorise existing task
	if (previous && previous.owner_id !== owner_id) {
		throw new Error("Unauthorized: User does not own this task");
	}

	let tag_ids: string[] = [];

	if (tags && tags.length > 0) {
		const { upsertTag } = await import("./tags");
		// update any of the tags
		const promises = tags.map(upsertTag);
		tag_ids = await Promise.all(promises);
	}

	const exists = !!previous;
	const project_id = data.project_id ?? previous?.project_id ?? null;

	// TODO: proper typesafety for upsert todo
	const upsert = data as any;
	upsert.updated_at = new Date().toISOString();
	upsert.owner_id = owner_id; // ensure owner_id is set correctly
	if (upsert.id == "" || upsert.id == null) delete upsert.id;

	let res: _FetchedTask[] | null = null;
	if (exists) {
		// perform update
		res = await db.update(task).set(upsert).where(eq(task.id, upsert.id)).returning();
	} else {
		// perform insert
		res = await db
			.insert(task)
			.values(upsert)
			.onConflictDoUpdate({ target: [task.id], set: upsert })
			.returning();
	}
	if (!res || res.length != 1) throw new Error(`Todo upsert returned incorrect rows (${res?.length ?? 0})`);

	const [new_todo] = res;

	const fresh_complete = data.progress == "COMPLETED" && previous?.progress != "COMPLETED";

	if (!exists) {
		// add CREATE_TASK action
		await addTaskAction({ owner_id, task_id: new_todo.id, type: "CREATE_TASK", description: "Created task", project_id });
	} else if (fresh_complete) {
		// add COMPLETE_TASK action
		await addTaskAction({ owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Completed task", project_id });
	} else {
		// add UPDATE_TASK action
		await addTaskAction({ owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Updated task", project_id });
	}

	// link each tag to every task
	if (tag_ids.length > 0) {
		await upsertTaskTags(new_todo.id, tag_ids);
	}

	return getTask(new_todo.id);
}

async function upsertTaskTags(task_id: string, tags: string[]) {
	const { getTaskTags } = await import("./tags");
	// get the current tags on the task
	const current = (await getTaskTags(task_id)).map((c) => c.id);

	// split into [new, existing]
	const create = tags.filter((tag_id) => !current.find((current_id) => current_id === tag_id));

	// delete any tags that are no longer in the list
	const delete_tags = current.filter((id) => !tags.includes(id));

	if (delete_tags.length > 0) {
		await db.delete(task_tag).where(and(eq(task_tag.task_id, task_id), inArray(task_tag.tag_id, delete_tags)));
	}

	// insert any new tags
	const insert_tags = create.map((t) => ({ task_id: task_id, tag_id: t }));
	if (insert_tags.length > 0) {
		await db.insert(task_tag).values(insert_tags);
	}

	// update the updated_at time on each link
	const { sql } = await import("drizzle-orm");
	await db
		.update(task_tag)
		.set({ updated_at: sql`CURRENT_TIMESTAMP` })
		.where(eq(task_tag.task_id, task_id));
}
