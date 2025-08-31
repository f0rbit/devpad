import { getProjectConfig, scanRepo } from "@devpad/core";
import { db, project } from "@devpad/schema/database";
import type { APIContext } from "astro";
import { and, eq } from "drizzle-orm";

// will have ?project_id=<id> query parameter
/** @todo capture stderr/stdout on the child processes */
/** @todo store context in db */

export async function POST(context: APIContext) {
	if (!context.locals.user || !context.locals.user.id || !context.locals.user.github_id) {
		return new Response("invalid auth", { status: 401 });
	}

	const { github_id } = context.locals.user;

	const project_id = context.url.searchParams.get("project_id");

	if (!project_id) {
		console.error("scan: no project id");
		return new Response("no project id", { status: 400 });
	}

	console.log("running scan for project: ", project_id);

	// check that user owns the project
	const project_query = await db
		.select()
		.from(project)
		.where(and(eq(project.id, project_id)));

	if (project_query.length !== 1) {
		console.error("scan: project not found");
		return new Response("project not found", { status: 404 });
	}

	const project_data = project_query[0];

	// now we want to invoke some more complex behaviour.
	// using the access_token from the session we want to clone the repo and then scan it using ../todo-tracker binary

	const access_token = context.locals.session?.access_token;

	if (!access_token) {
		console.error("scan: invalid access token");
		return new Response("invalid access token", { status: 401 });
	}

	const folder_id = `${github_id}-${crypto.randomUUID()}`;

	if (!project_data.repo_id || !project_data.repo_url) {
		console.error("scan: project isn't linked to a repo");
		return new Response("project isn't linked to a repo", { status: 400 });
	}

	const repo_url = project_data.repo_url;
	if (!repo_url) {
		console.error("scan: no repo url");
		return new Response("no repo url", { status: 400 });
	}

	let config;
	try {
		config = await getProjectConfig(project_id);
	} catch (e) {
		console.error("scan: error fetching project config", e);
		return new Response("error fetching project config", { status: 500 });
	}

	console.log("beginning scan", { repo_url, folder_id, config });

	return new Response(
		new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of scanRepo(repo_url, access_token, folder_id, config)) {
						controller.enqueue(chunk);
					}
					controller.close();
				} catch (e) {
					console.error("scan: error streaming response", e);
					controller.error(e);
				}
			},
		}),
		{ status: 200 }
	);
}
