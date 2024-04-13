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

	const repo_url = project_data.repo_url;
	if (!repo_url) {
		return new Response("no repo url", { status: 400 });
	}

	return new Response(new ReadableStream({
		async start(controller) {
			for await (const chunk of scan_repo(repo_url, access_token, folder_id)) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	}), { status: 200 });
}

async function* scan_repo(repo_url: string, access_token: string, folder_id: string) {
	yield "";
	yield "starting\n";
	// we need to get OWNER and REPO from the repo_url
	const slices = repo_url.split("/");
	const repo = slices.at(-1);
	const owner = slices.at(-2);


	yield "cloning repo\n";
	// clone the repo into a temp folder
	const clone = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball`, { headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });

	if (!clone.ok) {
		yield "error fetching repo from github\n";
		return;
	}

	const zip = await clone.arrayBuffer();

	const repo_path = `/tmp/${folder_id}.zip`;
	yield "writing repo to disk\n";
	await Bun.write(repo_path, zip);

	const unzipped_path = `/tmp/${folder_id}`;

	// call shell 'unzip'
	// await $`unzip ${repo_path} -d ${unzipped_path}`
	// call ^ using child_process 
	yield "decompressing repo\n";
	child_process.execSync(`unzip ${repo_path} -d ${unzipped_path}`);
	const config_path = "../todo-config.json"; // TODO: grab this from user config from 1. project config, 2. user config, 3. default config

	// generate the todo-tracker parse
	yield "scanning repo\n";
	child_process.execSync("../todo-tracker parse " + unzipped_path + " " + config_path + " > " + unzipped_path + "/new-output.json");

	// for now, lets return response of the new-output.json file
	const output_file = await (Bun.file(unzipped_path + "/new-output.json").text());
	yield "done\n";
	return;
}

