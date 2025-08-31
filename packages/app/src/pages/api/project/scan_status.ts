import type { APIContext } from "astro";
import { z } from "zod";
import { db, codebase_tasks, project, task, todo_updates, tracker_result } from "@devpad/schema/database";
import { and, eq, inArray, sql } from "drizzle-orm";
import { update_action, type UpdateData } from "@devpad/schema";
import { addTaskAction, getUpsertedTaskMap, getActiveUserTagsMapByName, linkTaskToTag } from "@devpad/core";

const request_schema = z.object({
	id: z.number(),
	actions: z.record(update_action, z.array(z.string())), // UpdateAction -> task_id[]
	titles: z.record(z.string(), z.string()), // task_id -> title, this will only be for tasks that are NEW
	approved: z.boolean(),
});

// should have ?project_id=<project-id>

export async function POST(context: APIContext) {
	if (!context.locals.user) {
		return new Response(null, { status: 401 });
	}

	const { id: user_id } = context.locals.user;

	const project_id = context.url.searchParams.get("project_id");

	if (!project_id) {
		return new Response("no project id", { status: 400 });
	}

	const body = await context.request.json();

	const parsed = request_schema.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}
	const { actions, id: update_id, approved, titles } = parsed.data;

	// check that the user owns the project
	const project_query = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length != 1) {
		return new Response("project not found", { status: 404 });
	}

	// check that there is an update with the given id
	const update_query = await db
		.select()
		.from(todo_updates)
		.where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.id, update_id)));

	if (update_query.length != 1) {
		return new Response("update not found", { status: 404 });
	}

	// take the new_id from the update_query and set it's status to approved
	const update_data = update_query[0];
	const new_id = update_data.new_id;

	await db.update(tracker_result).set({ accepted: approved }).where(eq(tracker_result.id, new_id));

	// then we want to execute the update
	await db
		.update(todo_updates)
		.set({ status: approved ? "ACCEPTED" : "REJECTED" })
		.where(eq(todo_updates.id, update_id));

	// TODO: extract this to function that throws errors on failure
	if (approved) {
		const codebase_map = new Map<string, UpdateData>();
		// update all the tasks within the update and codebase_task table
		// TODO: add typesafety to this, either infer datatype from schema or use zod validator
		let codebase_items: UpdateData[];
		try {
			codebase_items = JSON.parse(update_query[0].data as string) as UpdateData[];
			codebase_items.forEach((item) => {
				codebase_map.set(item.id, item);
			});
		} catch (e) {
			console.error(e);
			return new Response("error parsing update data", { status: 500 });
		}

		const tag_map = await getActiveUserTagsMapByName(user_id);

		const actionable_items = actions.IGNORE && actions.IGNORE.length > 0 ? codebase_items.filter((item) => !actions.IGNORE!.includes(item.id)) : codebase_items;

		// we want to group into 'upserts', 'deletes'
		const upserts = actionable_items.filter((item) => item.type == "NEW" || item.type == "UPDATE" || item.type == "SAME" || item.type == "MOVE");
		const deletes = actionable_items.filter((item) => item.type == "DELETE");

		// run the upserts
		const upsert_item = async (item: any) => {
			const id = item.id;
			const type = item.tag;
			const text = item.data.new?.text;
			const line = item.data.new?.line;
			const file = item.data.new?.file;
			const context = item.data.new?.context;

			const branch = update_query[0].branch;
			const commit_sha = update_query[0].commit_sha;
			const commit_msg = update_query[0].commit_msg;
			const commit_url = update_query[0].commit_url;

			const values = { id, type, text, line, file, recent_scan_id: new_id, context, branch, commit_sha, commit_msg, commit_url, updated_at: sql`CURRENT_TIMESTAMP` };

			await db
				.insert(codebase_tasks)
				.values(values)
				.onConflictDoUpdate({ target: [codebase_tasks.id], set: values });
		};

		try {
			await Promise.all(upserts.map(upsert_item));
		} catch (e) {
			console.error(e);
			return new Response("error upserting tasks", { status: 500 });
		}

		// this will upsert new tasks if they don't exist
		const task_map = await getUpsertedTaskMap(actionable_items);

		// run the deletes
		const delete_item = async (item: any) => {
			const id = item.id;

			await db.delete(codebase_tasks).where(eq(codebase_tasks.id, id));
			// TODO: consider deleting the task from the task table as well
		};

		try {
			await Promise.all(deletes.map(delete_item));
		} catch (e) {
			console.error(e);
			return new Response("error deleting tasks", { status: 500 });
		}

		const connect_tags = [] as { task_id: string; codebase_task_id: string }[];

		try {
			// update the underlying tasks
			if (actions.CREATE) {
				const values = actions.CREATE.map((item) => {
					let title = "New Item";
					if (titles[item]) {
						title = titles[item];
					} else if (codebase_map.has(item)) {
						title = codebase_map.get(item)?.data.new.text ?? "New Item";
					}
					return { codebase_task_id: item, project_id, title, owner_id: user_id, updated_at: sql`CURRENT_TIMESTAMP` };
				});
				for (const item of values) {
					const new_task = await db
						.insert(task)
						.values(item)
						.onConflictDoUpdate({ target: [task.id], set: item })
						.returning();
					await addTaskAction({ owner_id: user_id, task_id: new_task[0].id, type: "CREATE_TASK", description: "Task created (via scan)", project_id });
					connect_tags.push({ task_id: new_task[0].id, codebase_task_id: item.codebase_task_id });
				}
			}
			if (actions.DELETE) {
				// set task.visibility to DELETED
				const task_ids = actions.DELETE.map((item) => task_map.get(item)).filter(Boolean) as string[];
				await db
					.update(task)
					.set({ visibility: "DELETED", codebase_task_id: null, updated_at: sql`CURRENT_TIMESTAMP` })
					.where(inArray(task.id, task_ids));
				for (const task_id of task_ids) {
					await addTaskAction({ owner_id: user_id, task_id, type: "DELETE_TASK", description: "Task deleted (via scan)", project_id });
				}
			}
			if (actions.UNLINK) {
				const task_ids = actions.UNLINK.map((item) => task_map.get(item)).filter(Boolean) as string[];
				await db
					.update(task)
					.set({ codebase_task_id: null, updated_at: sql`CURRENT_TIMESTAMP` })
					.where(inArray(task.id, task_ids));
				for (const task_id of task_ids) {
					await addTaskAction({ owner_id: user_id, task_id, type: "UPDATE_TASK", description: "Task unlinked (via scan)", project_id });
					connect_tags.push({ task_id, codebase_task_id: task_map.get(task_id)! });
				}
			}
			if (actions.COMPLETE) {
				const task_ids = actions.COMPLETE.map((item) => task_map.get(item)).filter(Boolean) as string[];
				await db
					.update(task)
					.set({ progress: "COMPLETED", updated_at: sql`CURRENT_TIMESTAMP` })
					.where(inArray(task.id, task_ids));
				for (const task_id of task_ids) {
					await addTaskAction({ owner_id: user_id, task_id, type: "UPDATE_TASK", description: "Task completed (via scan)", project_id });
					connect_tags.push({ task_id, codebase_task_id: task_map.get(task_id)! });
				}
			}
			if (actions.CONFIRM) {
				const task_promises = actions.CONFIRM.map(async (ctid) => {
					const task_id = task_map.get(ctid);
					if (!task_id) {
						console.error(`task ${ctid} not found`);
						return null;
					}
					await db.update(task).set({ codebase_task_id: ctid }).where(eq(task.id, task_id));
					connect_tags.push({ task_id, codebase_task_id: ctid });
				}).filter(Boolean);
				await Promise.all(task_promises);
			}
		} catch (e) {
			console.error(e);
			return new Response("error updating tasks", { status: 500 });
		}

		try {
			// upsert all the tags
			const tag_promises = connect_tags
				.map(async (t) => {
					const codebase_task = codebase_map.get(t.codebase_task_id);
					if (!codebase_task) {
						console.error(`codebase_task for ${t.codebase_task_id} not found`);
						return null;
					}
					const tag = tag_map.get(codebase_task.tag);
					if (!tag) {
						console.error(`tag for ${t.codebase_task_id} not found`);
						return null;
					}
					await linkTaskToTag(t.task_id, tag.id);
				})
				.filter(Boolean);

			await Promise.all(tag_promises);
		} catch (e) {
			console.error(e);
			return new Response("error linking tags", { status: 500 });
		}
	}

	return new Response(null, { status: 200 });
}
