import { action, github, milestones, projects, tags } from "@devpad/core/services";
import { save_config_request, upsert_project } from "@devpad/schema";
import { ignore_path, project, tag, tag_config } from "@devpad/schema/database";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../../bindings.js";
import { requireAuth } from "../../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const query = c.req.query();

	if (query.id) {
		const result = await projects.getProjectById(db, query.id);
		if (!result.ok) {
			if (result.error.kind === "not_found") return c.json(null, 404);
			return c.json({ error: result.error.kind }, 500);
		}
		if (result.value.owner_id !== auth_user.id) return c.json(null, 401);
		return c.json(result.value);
	}

	if (query.name) {
		const result = await projects.getProject(db, auth_user.id, query.name);
		if (!result.ok) {
			if (result.error.kind === "not_found") return c.json(null, 404);
			return c.json({ error: result.error.kind }, 401);
		}
		return c.json(result.value);
	}

	const result = await projects.getUserProjects(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/public", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await projects.getUserProjects(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);

	const public_projects = result.value.filter(p => p.visibility === "PUBLIC");
	return c.json(public_projects);
});

app.patch("/", requireAuth, zValidator("json", upsert_project), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	if (data.owner_id && data.owner_id !== auth_user.id) {
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}

	const session = c.get("session");
	const access_token = session?.access_token;

	const github_client: projects.GitHubClient = {
		getRepoMetadata: access_token
			? async (owner: string, repo: string, token: string) => {
					const result = await github.getRepoMetadata(owner, repo, token);
					if (!result.ok) throw new Error("Failed to get repo metadata");
					return result.value;
				}
			: undefined,
		getSpecification: access_token
			? async (owner: string, repo: string, token: string) => {
					const result = await github.getSpecification(owner, repo, token);
					if (!result.ok) throw new Error("Failed to get specification");
					return result.value;
				}
			: undefined,
	};

	const auth_channel = c.get("auth_channel");
	const result = await projects.upsertProject(db, data, auth_user.id, access_token ?? undefined, github_client, auth_channel);
	if (!result.ok) {
		if (result.error.kind === "forbidden") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "protected") return c.json({ error: result.error.message, entity_id: result.error.entity_id, modified_by: result.error.modified_by, modified_at: result.error.modified_at }, 409);
		if (result.error.kind === "bad_request") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.get("/:project_id/history", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.param("project_id");

	if (!project_id) return c.json({ error: "Missing project_id parameter" }, 400);

	const project_result = await projects.getProjectById(db, project_id);
	if (!project_result.ok) return c.json({ error: project_result.error.kind }, project_result.error.kind === "not_found" ? 404 : 500);
	if (project_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const result = await action.getProjectHistory(db, project_result.value.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/config", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "Missing project_id parameter" }, 400);

	const project_result = await projects.getProjectById(db, project_id);
	if (!project_result.ok) return c.json({ error: project_result.error.kind }, project_result.error.kind === "not_found" ? 404 : 500);
	if (project_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const tag_configs = await db
		.select({
			tag_id: tag_config.tag_id,
			match: tag_config.match,
			tag_name: tag.title,
			tag_color: tag.color,
		})
		.from(tag_config)
		.leftJoin(tag, eq(tag_config.tag_id, tag.id))
		.where(eq(tag_config.project_id, project_id));

	const grouped_tags = Object.values(
		tag_configs.reduce(
			(acc, config) => {
				const tag_id = config.tag_id;
				if (!acc[tag_id]) {
					acc[tag_id] = {
						name: config.tag_name || "Unknown",
						color: config.tag_color,
						match: [config.match],
					};
				} else {
					acc[tag_id].match.push(config.match);
				}
				return acc;
			},
			{} as Record<string, { name: string; color: string | null; match: string[] }>
		)
	);

	const ignore_paths = await db.select({ path: ignore_path.path }).from(ignore_path).where(eq(ignore_path.project_id, project_id));

	return c.json({
		config: { tags: grouped_tags, ignore: ignore_paths.map(p => p.path) },
		scan_branch: project_result.value.scan_branch ?? "main",
	});
});

app.get("/fetch_spec", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "Missing project_id parameter" }, 400);

	const project_result = await projects.getProjectById(db, project_id);
	if (!project_result.ok) return c.json({ error: project_result.error.kind }, project_result.error.kind === "not_found" ? 404 : 500);
	if (project_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const repo_url = project_result.value.repo_url;
	if (!repo_url) return c.json({ error: "Project has no repo_url" }, 400);

	const slices = repo_url.split("/");
	const repo = slices.at(-1);
	const owner = slices.at(-2);
	if (!repo || !owner) return c.json({ error: "Invalid repo_url" }, 400);

	const session = c.get("session");
	const access_token = session?.access_token;
	if (!access_token) return c.json({ error: "GitHub access token required" }, 401);

	const result = await github.getSpecification(owner, repo, access_token);
	if (!result.ok) return c.json({ error: "Error fetching specification" }, 500);
	return new Response(result.value);
});

app.patch("/save_config", requireAuth, zValidator("json", save_config_request), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	const found_result = await projects.getProjectById(db, data.id);
	if (!found_result.ok) {
		if (found_result.error.kind === "not_found") return c.json({ error: "Project not found" }, 404);
		return c.json({ error: found_result.error.kind }, 500);
	}
	if (found_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	try {
		const current_tags = await db.select({ id: tag_config.tag_id }).from(tag_config).where(eq(tag_config.project_id, data.id));

		let tag_ids: string[] = [];
		if (data.config.tags.length > 0) {
			const tag_promises = data.config.tags.map(async t => {
				const tag_result = await tags.upsertTag(db, { owner_id: auth_user.id, title: t.name, deleted: false, color: null, render: true });
				if (!tag_result.ok) throw new Error("Failed to upsert tag");
				const tag_id = tag_result.value;

				const current_matches = await db
					.select({ match: tag_config.match })
					.from(tag_config)
					.where(and(eq(tag_config.project_id, data.id), eq(tag_config.tag_id, tag_id)));

				const current_match_set = new Set(current_matches.map(m => m.match));
				const new_matches = t.match.filter(m => !current_match_set.has(m));

				if (new_matches.length > 0) {
					const values = new_matches.map(match => ({ project_id: data.id, tag_id, match }));
					await db.insert(tag_config).values(values);
				}

				const matches_to_remove = current_matches.filter(m => !t.match.includes(m.match)).map(m => m.match);

				if (matches_to_remove.length > 0) {
					await db.delete(tag_config).where(and(eq(tag_config.project_id, data.id), eq(tag_config.tag_id, tag_id), inArray(tag_config.match, matches_to_remove)));
				}

				return tag_id;
			});

			tag_ids = await Promise.all(tag_promises);
		}

		const tags_to_remove = current_tags.filter(t => !tag_ids.includes(t.id)).map(t => t.id);
		if (tags_to_remove.length > 0) {
			await db.delete(tag_config).where(and(eq(tag_config.project_id, data.id), inArray(tag_config.tag_id, tags_to_remove)));
		}

		const current_paths = await db.select({ path: ignore_path.path }).from(ignore_path).where(eq(ignore_path.project_id, data.id));
		const current_path_set = new Set(current_paths.map(p => p.path));
		const new_paths = data.config.ignore.filter(p => !current_path_set.has(p));

		if (new_paths.length > 0) {
			await db.insert(ignore_path).values(new_paths.map(path => ({ project_id: data.id, path })));
		}

		const paths_to_remove = current_paths.filter(p => !data.config.ignore.includes(p.path)).map(p => p.path);
		if (paths_to_remove.length > 0) {
			await db.delete(ignore_path).where(and(eq(ignore_path.project_id, data.id), inArray(ignore_path.path, paths_to_remove)));
		}

		if (data.scan_branch) {
			await db.update(project).set({ scan_branch: data.scan_branch }).where(eq(project.id, data.id));
		}

		return c.json(null, 200);
	} catch {
		return c.json({ error: "Error saving configuration" }, 500);
	}
});

app.get("/:id/milestones", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.param("id");

	if (!project_id) return c.json({ error: "Missing project ID" }, 400);

	const project_result = await projects.getProjectById(db, project_id);
	if (!project_result.ok) {
		if (project_result.error.kind === "not_found") return c.json({ error: "Project not found" }, 404);
		return c.json({ error: project_result.error.kind }, 500);
	}
	if (project_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const result = await milestones.getProjectMilestones(db, project_result.value.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/repos", requireAuth, async c => {
	const session = c.get("session");
	if (!session?.access_token) {
		return c.json({ error: "GitHub access token not available. Please re-authenticate with GitHub." }, 401);
	}

	const result = await github.getRepos(session.access_token);
	if (!result.ok) return c.json({ error: "Failed to fetch repositories" }, 500);
	return c.json(result.value);
});

app.get("/repos/:owner/:repo/branches", requireAuth, async c => {
	const db = c.get("db");
	const session = c.get("session");
	const owner = c.req.param("owner");
	const repo = c.req.param("repo");

	if (!session?.access_token) {
		return c.json({ error: "GitHub access token not available. Please re-authenticate with GitHub." }, 401);
	}
	if (!owner || !repo) return c.json({ error: "Missing owner or repo parameter" }, 400);

	const result = await github.getBranches(db, owner, repo, session.access_token);
	if (!result.ok) return c.json({ error: "Failed to fetch branches" }, 500);
	return c.json(result.value);
});

export default app;
