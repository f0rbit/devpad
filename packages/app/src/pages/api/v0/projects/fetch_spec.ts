import type { APIContext } from "astro";
import { getSpecification, getProjectById, getAuthedUser } from "@devpad/core";

export async function GET(context: APIContext) {
	const { user_id, error: auth_error } = await getAuthedUser(context);
	if (auth_error) {
		return new Response(auth_error, { status: 401 });
	}
	if (!user_id) {
		return new Response(null, { status: 401 });
	}

	// project_id is in the query params
	const project_id = context.url.searchParams.get("project_id");
	if (!project_id) {
		return new Response("Missing project_id parameter", { status: 400 });
	}

	try {
		const { project, error } = await getProjectById(project_id);
		if (error) return new Response(error, { status: 500 });
		if (!project) return new Response("Project not found", { status: 404 });
		if (project.owner_id != user_id) return new Response("Unauthorized", { status: 401 });

		const repo_url = project.repo_url;
		if (!repo_url) return new Response("Project has no repo_url", { status: 400 });

		const slices = repo_url.split("/");
		const repo = slices.at(-1);
		const owner = slices.at(-2);
		if (!repo || !owner) return new Response("Invalid repo_url", { status: 400 });

		const access_token = context.locals.session?.access_token;
		if (!access_token) return new Response("GitHub access token required", { status: 401 });

		const readme = await getSpecification(owner, repo, access_token);
		return new Response(readme);
	} catch (err) {
		console.error(`fetch_spec: `, err);
		return new Response("Error fetching specification", { status: 500 });
	}
}