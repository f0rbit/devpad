import type { APIContext } from "astro";
import { db } from "../../../../database/db";
import { and, eq } from "drizzle-orm";
import { project } from "../../../../database/schema";
import child_process from "child_process";


// will have ?project_id=<id> query parameter

export async function POST(context: APIContext) {
	if (!context.locals.user || !context.locals.user.id || !context.locals.user.github_id) {
		return new Response("invalid auth", { status: 401 });
	}

	const { id: user_id, github_id } = context.locals.user;

	const project_id = context.url.searchParams.get("project_id");

	if (!project_id) {
		return new Response("no project id", { status: 400 });
	}

	// check that user owns the project
	const project_query = await db.select().from(project).where(and(eq(project.project_id, project_id), eq(project.owner_id, user_id)));

	if (project_query.length != 1) {
		return new Response("project not found", { status: 404 });
	}

	const project_data = project_query[0];

	// now we want to invoke some more complex behaviour.
	// using the access_token from the session we want to clone the repo and then scan it using ../todo-tracker binary
	
	const access_token = context.locals.session?.access_token;

	if (!access_token) {
		return new Response("invalid access token", { status: 401 });
	}

	const folder_id = github_id + "-" + crypto.randomUUID();

	if (!project_data.repo_id || !project_data.repo_url) {
		return new Response("project isn't linked to a repo", { status: 400 });
	}

	// we need to get OWNER and REPO from the repo_url
	const slices = project_data.repo_url.split("/");
	const repo = slices.at(-1);
	const owner = slices.at(-2);

	console.log({ access_token, repo, owner });

	// clone the repo into a temp folder
	const clone = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball`, { headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
	console.log("cloning response", { status: clone.status, text: clone.statusText });
	if (!clone.ok) {
		return new Response("error fetching repo from github", { status: 500 });
	}

	const zip = await clone.arrayBuffer();

	const repo_path = `/tmp/${folder_id}.zip`;

	await Bun.write(repo_path, zip);
	
	const unzipped_path = `/tmp/${folder_id}`;

	// call shell 'unzip'
	// await $`unzip ${repo_path} -d ${unzipped_path}`
	// call ^ using child_process 
	child_process.execSync(`unzip ${repo_path} -d ${unzipped_path}`);

	return new Response(`cloned repo to ${unzipped_path}`, { status: 200 });
}
