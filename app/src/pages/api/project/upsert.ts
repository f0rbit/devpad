import type { APIContext } from "astro";
import { upsert_user } from "../../../server/types";
import { db } from "../../../../database/db";
import { project } from "../../../../database/schema";

export async function PATCH(context: APIContext) {
	// first we need to validate that the user is logged in
	if (!context.locals.user) {
		return new Response(null, { status: 401 });
	}

	// extract the form contents from the input
	const body = await context.request.json();

	// validate project contents using zod & return error if anything missing
	const parsed = upsert_user.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}
	const upsert_project = parsed.data;

	// assert that the owner_id of upsert_project is same as logged in user
	if (upsert_project.owner_id != context.locals.user.id) {
		return new Response(null, { status: 401 });
	}

	try {
		// perform db upsert
		const new_project = await db.insert(project).values(upsert_project).onConflictDoUpdate({ target: [project.owner_id, project.project_id], set: upsert_project }).returning();

		if (new_project.length != 1) throw new Error(`Project upsert returned incorrect rows (${new_project.length}`);
		// return the project data
		return new Response(JSON.stringify(new_project[0]));
	} catch (err) {
		console.error(err);
		return new Response(null, { status: 500 });
	}
}
