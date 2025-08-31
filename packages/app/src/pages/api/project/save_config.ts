import type { APIContext } from "astro";
import { z } from "zod";
import { db, project, tag_config, ignore_path } from "@devpad/schema/database";
import { eq, and, inArray } from "drizzle-orm";
import { ConfigSchema } from "../../../server/types";
import { getProjectById } from "../../../server/projects";
import { upsertTag } from "../../../server/tags";
import { getAuthedUser } from "../../../server/keys";

const schema = z.object({
	id: z.string(),
	config: ConfigSchema,
	scan_branch: z.string().optional(),
});

export async function PATCH(context: APIContext) {
	// Validate that the user is authenticated via API key
	const { user_id, error: auth_error } = await getAuthedUser(context);
	if (auth_error) {
		return new Response(auth_error, { status: 401 });
	}
	if (!user_id) {
		return new Response(null, { status: 401 });
	}

	const body = await context.request.json();

	// Validate input using Zod
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		console.warn(parsed.error);
		return new Response(parsed.error.message, { status: 400 });
	}

	const { data } = parsed;

	// Fetch the project to ensure user authorization
	const { project: found, error } = await getProjectById(data.id);
	if (error) return new Response(error, { status: 500 });
	if (!found) return new Response("Project not found", { status: 404 });
	if (found.owner_id != user_id) return new Response("Unauthorized", { status: 401 });

	try {
		// get current tags
		const current_tags = await db.select({ id: tag_config.tag_id }).from(tag_config).where(eq(tag_config.project_id, data.id));
		// Upsert Tags
		let tag_ids: string[] = [];
		if (data.config.tags.length > 0) {
			const tag_promises = data.config.tags.map(async (tag) => {
				// TODO: pick random color from set of presets
				const tag_id = await upsertTag({ owner_id: user_id, title: tag.name, deleted: false, color: null, render: true });

				// Upsert tag matches into `tag_config`
				const current_matches = await db
					.select({ match: tag_config.match })
					.from(tag_config)
					.where(and(eq(tag_config.project_id, data.id), eq(tag_config.tag_id, tag_id)));

				const current_match_set = new Set(current_matches.map((match) => match.match));
				const new_matches = tag.match.filter((m) => !current_match_set.has(m));

				// Insert new matches
				if (new_matches.length > 0) {
					const values = new_matches.map((match) => ({ project_id: data.id, tag_id: tag_id, match: match }));
					await db.insert(tag_config).values(values);
				}

				// Remove old matches not in the current configuration
				const matches_to_remove = current_matches.filter((m) => !tag.match.includes(m.match)).map((m) => m.match);

				if (matches_to_remove.length > 0) {
					await db.delete(tag_config).where(and(eq(tag_config.project_id, data.id), eq(tag_config.tag_id, tag_id), inArray(tag_config.match, matches_to_remove)));
				}

				return tag_id;
			});

			tag_ids = await Promise.all(tag_promises);
		}

		// remove any old tags that arent in tag_ids
		const tags_to_remove = current_tags.filter((t) => !tag_ids.includes(t.id)).map((t) => t.id);

		if (tags_to_remove.length > 0) {
			await db.delete(tag_config).where(and(eq(tag_config.project_id, data.id), inArray(tag_config.tag_id, tags_to_remove)));
		}

		// Upsert Ignore Paths
		const current_paths = await db.select({ path: ignore_path.path }).from(ignore_path).where(eq(ignore_path.project_id, data.id));

		const current_path_set = new Set(current_paths.map((p) => p.path));
		const new_paths = data.config.ignore.filter((p) => !current_path_set.has(p));

		if (new_paths.length > 0) {
			await db.insert(ignore_path).values(new_paths.map((path) => ({ project_id: data.id, path })));
		}

		const paths_to_remove = current_paths.filter((p) => !data.config.ignore.includes(p.path)).map((p) => p.path);

		if (paths_to_remove.length > 0) {
			await db.delete(ignore_path).where(and(eq(ignore_path.project_id, data.id), inArray(ignore_path.path, paths_to_remove)));
		}

		if (data.scan_branch) {
			// Update project with the scan_branch and save the configuration
			await db.update(project).set({ scan_branch: data.scan_branch! }).where(eq(project.id, data.id));
		}

		return new Response(null, { status: 200 });
	} catch (err) {
		console.error("Error saving configuration:", err);
		return new Response(null, { status: 500 });
	}
}
