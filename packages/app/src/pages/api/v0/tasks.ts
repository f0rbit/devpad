// api endpoint for getting tasks
// params
// optional ?id=<task_uuid>
// optional ?tag=<tag_uuid>
// optional ?project=<project_uuid>

import type { APIContext } from "astro";
import { getProjectTasks, getTask, getTasksByTag, getUserTasks, upsertTask } from "../../../server/tasks";
import { getAuthedUser } from "../../../server/keys";
import { upsert_todo, upsert_tag } from "../../../server/types";
import { z } from "zod";

export async function GET(context: APIContext) {
	const { user_id, error } = await getAuthedUser(context);
	if (error) {
		return new Response(error, { status: 401 });
	}
	if (!user_id) {
		return new Response(null, { status: 401 });
	}

	// extract the query params from the request
	const query = context.url.searchParams;

	// extract the task id from the query params
	const id = query.get("id");
	const tag = query.get("tag");
	const project = query.get("project");

	if (id) {
		// get the task by id
		const task = await getTask(id);
		if (!task) {
			return new Response(null, { status: 404 });
		}
		if (task.task.owner_id != user_id) {
			return new Response(null, { status: 401 });
			// return new Response(null, { status: 401 });
		}
		return new Response(JSON.stringify(task));
	}

	if (tag) {
		// get the tasks by tag
		const tasks = await getTasksByTag(tag);
		if (error) {
			return new Response(error, { status: 401 });
		}
		if (!tasks) {
			return new Response(null, { status: 404 });
		}
		return new Response(JSON.stringify(tasks));
	}

	if (project) {
		// get the tasks by project
		const tasks = await getProjectTasks(project);
		if (!tasks) {
			return new Response(null, { status: 404 });
		}
		return new Response(JSON.stringify(tasks));
	}

	// no query params provided
	// return all tasks
	const tasks = await getUserTasks(user_id);
	return new Response(JSON.stringify(tasks, null, 2));
}

const upsert_tags = z.array(upsert_tag);

export async function PATCH(context: APIContext) {
	const { user_id, error } = await getAuthedUser(context);
	if (error) {
		return new Response(error, { status: 401 });
	}
	if (!user_id) {
		return new Response(null, { status: 401 });
	}

	const body = await context.request.json();

	const parsed = upsert_todo.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}
	const { data } = parsed;

	// ensure owner_id matches the authenticated user
	if (data.owner_id !== user_id) {
		return new Response("Unauthorized: owner_id mismatch", { status: 401 });
	}

	let tags: any[] = [];

	if (body.tags) {
		// parse upsert tags
		const tag_parse = upsert_tags.safeParse(body.tags);
		if (!tag_parse.success) {
			console.warn(tag_parse.error);
			return new Response(tag_parse.error.message, { status: 400 });
		}
		tags = tag_parse.data;
	}

	try {
		const new_todo = await upsertTask(data, tags, user_id);
		return new Response(JSON.stringify(new_todo), { status: 200 });
	} catch (err) {
		console.error("Error upserting todo", err);
		if (err instanceof Error) {
			if (err.message.includes("Unauthorized")) {
				return new Response(err.message, { status: 401 });
			}
			if (err.message.includes("Bad Request")) {
				return new Response(err.message, { status: 400 });
			}
		}
		return new Response("Internal Server Error", { status: 500 });
	}
}
