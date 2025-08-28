// the AUTH_KEY should be in the headers of the request
// this endpoint is a GET request that accepts some optional query params
// ?id=<project_uuid>
// ?name=<project_name>
// this is a astro api endpoint
import type { APIContext } from "astro";
import { getProject, getProjectById, getUserProjects, upsertProject } from "../../../server/projects";
import { getAuthedUser } from "../../../server/keys";
import { upsert_project } from "../../../server/types";

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

	// extract the project id from the query params
	const id = query.get("id");
	const name = query.get("name");

	if (id) {
		// get the project by id
		const { project, error } = await getProjectById(id);
		if (error) {
			if (error == "Couldn't find project") {
				return new Response(null, { status: 404 });
			}
			return new Response(error, { status: 500 });
		}
		if (!project) {
			return new Response(null, { status: 404 });
		}
		if (project.owner_id != user_id) {
			return new Response(null, { status: 401 });
		}
		return new Response(JSON.stringify(project));
	}

	if (name) {
		// get the project by name
		const { project, error } = await getProject(user_id, name);
		if (error) {
			if (error == "Couldn't find project") {
				return new Response(null, { status: 404 });
			}
			return new Response(error, { status: 401 });
		}
		if (!project) {
			return new Response(null, { status: 404 });
		}
		return new Response(JSON.stringify(project));
	}

	// no query params provided
	// return all projects
	const projects = await getUserProjects(user_id);

	// should only show 'public' projects
	const public_projects = projects.filter((project) => project.visibility == "PUBLIC");
	return new Response(JSON.stringify(public_projects));
}

export async function PATCH(context: APIContext) {
	const { user_id, error } = await getAuthedUser(context);
	if (error) {
		return new Response(error, { status: 401 });
	}
	if (!user_id) {
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

	// assert that the owner_id of upsert_project is same as authed user
	if (data.owner_id && data.owner_id != user_id) {
		console.log("Unauthorized: owner_id mismatch", { user_id, owner_id: data.owner_id });
		return new Response("Unauthorized: owner_id mismatch", { status: 401 });
	}

	try {
		// Note: API key based auth doesn't have GitHub access token, so GitHub specification fetching is disabled
		const new_project = await upsertProject(data, user_id);

		// return the project data
		return new Response(JSON.stringify(new_project));
	} catch (err) {
		console.error(err);
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
