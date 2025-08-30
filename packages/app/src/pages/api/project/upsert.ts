import type { APIContext } from "astro";
import { upsert_project, type UpsertProject } from "../../../server/types";
import { upsertProject } from "../../../server/projects";

type CompleteUpsertProject = Omit<UpsertProject, "id"> & { id: string };

export async function PATCH(context: APIContext) {
	// first we need to validate that the user is logged in
	if (!context.locals.user) {
		return new Response(null, { status: 401 });
	}

	// extract the form contents from the input
	const body = await context.request.json();

	// validate project contents using zod & return error if anything missing
	const parsed = upsert_project.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}
	const { data } = parsed;

	// assert that the owner_id of upsert_project is same as logged in user
	if (data.owner_id && data.owner_id != context.locals.user.id) {
		return new Response(null, { status: 401 });
	}
	
	try {
		const access_token = context.locals.session?.access_token;
		const new_project = await upsertProject(data, context.locals.user.id, access_token);

		// return the project data
		return new Response(JSON.stringify(new_project));
	} catch (err) {
		console.error(err);
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
