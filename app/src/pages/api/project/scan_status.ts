import type { APIContext } from "astro";
import { z } from "zod";
import { db } from "../../../../database/db";
import { project, todo_updates, tracker_result } from "../../../../database/schema";
import { and, eq } from "drizzle-orm";

const request_schema = z.object({
	id: z.number(),
	approved: z.boolean()
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
	const { approved, id: update_id } = parsed.data;

	// check that the user owns the project
	const project_query = await db.select().from(project).where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length != 1) {
		return new Response("project not found", { status: 404 });
	}

	// check that there is an update with the given id
	const update_query = await db.select().from(todo_updates).where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.id, update_id)));

	if (update_query.length != 1) {
		return new Response("update not found", { status: 404 });
	}

	// take the new_id from the update_query and set it's status to approved
	const update_data = update_query[0];
	const new_id = update_data.new_id;

	await db.update(tracker_result).set({ accepted: approved }).where(eq(tracker_result.id, new_id));

	// then we want to execute the update
	await db.update(todo_updates).set({ status: approved ? "ACCEPTED" : "REJECTED" }).where(eq(todo_updates.id, update_id));

	return new Response(null, { status: 200 });
}
