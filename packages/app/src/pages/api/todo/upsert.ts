import type { APIContext } from "astro";
import { upsert_tag, upsert_todo } from "../../../server/types";
import { z } from "zod";
import { upsertTask } from "../../../server/tasks";
import { getAuthedUser } from "../../../server/keys";

// type CompleteUpsertTodo = Omit<UpsertTodo, "todo_id"> & { id: string, updated_at: string };

const upsert_tags = z.array(upsert_tag);

export async function PUT(context: APIContext) {
	const { user_id, error } = await getAuthedUser(context);
	if (error) {
		return new Response(error, { status: 401 });
	}
	if (!user_id) {
		return new Response(null, { status: 401 });
	}

	// remove /todo/new from history
	if (typeof context != 'undefined' && context.session && (await context.session!.has("history"))) {
		const history = (await context.session.get("history")) ?? [];
		console.log(history);
		if (history.at(-1) == "/todo/new") {
			history.pop();
			context.session.set("history", history);
		}
	}

	const body = await context.request.json();

	const parsed = upsert_todo.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}
	const { data } = parsed;

	if (data.owner_id != user_id) {
		return new Response(null, { status: 401 });
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
				return new Response(null, { status: 401 });
			}
			if (err.message.includes("Bad Request")) {
				return new Response(null, { status: 400 });
			}
		}
		return new Response(null, { status: 500 });
	}
}
