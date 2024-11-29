import type { APIContext } from "astro";
import { upsert_project, type UpsertProject } from "../../../server/types";
import { db } from "../../../../database/db";
import { project } from "../../../../database/schema";

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
	if (data.owner_id != context.locals.user.id) {
		return new Response(null, { status: 401 });
	}

	try {

		// the new_project is imported from github and doesn't have a specification, import it from the README
		if (data.repo_id && data.repo_url && !data.specification) {
			// we need to get OWNER and REPO from the repo_url
			const slices = data.repo_url.split("/");
			const repo = slices.at(-1);
			const owner = slices.at(-2);
			if (!context?.locals?.session?.access_token) throw new Error("Linking a github repo without access token");
			const access_token = context.locals.session.access_token;
			const readme_response = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: { "Accept": "application/vnd.github.raw+json", "Authorization": `Bearer ${access_token}`, "X-GitHub-Api-Version": "2022-11-28" } });
			if (!readme_response || !readme_response.ok) {
				console.warn(`Code ${readme_response.status} - ${readme_response.statusText}`);
				throw new Error("Error fetching readme");
			}
			try {
				data.specification = (await readme_response.text()) ?? null;
			} catch (err) {
				console.log(`Error reading raw text: ${err} - ${readme_response.status} ${readme_response.statusText}`);
				throw err;
			}
		}

		const insert = data as CompleteUpsertProject;
		// perform db upsert
		const new_project = await db.insert(project).values(insert).onConflictDoUpdate({ target: [project.id], set: insert }).returning();

		if (new_project.length != 1) throw new Error(`Project upsert returned incorrect rows (${new_project.length}`);

		// return the project data
		return new Response(JSON.stringify(new_project[0]));
	} catch (err) {
		console.error(err);
		return new Response(null, { status: 500 });
	}
}
