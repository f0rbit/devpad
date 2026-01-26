import { keysD1 } from "@devpad/core/auth";
import { actionD1, githubD1, goalsD1, milestonesD1, projectsD1, scanningD1, tagsD1, tasksD1, usersD1 } from "@devpad/core/services";
import { save_config_request, save_tags_request, update_user, upsert_goal, upsert_milestone, upsert_project, upsert_todo } from "@devpad/schema";
import { ignore_path, project, tag, tag_config } from "@devpad/schema/database";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import type { AppContext } from "../bindings.js";
import { requireAuth } from "../middleware/auth.js";

const app = new Hono<AppContext>();

app.get("/", c => c.json({ version: "0", status: "ok" }));

app.get("/projects", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const query = c.req.query();

	if (query.id) {
		const result = await projectsD1.getProjectById(db, query.id);
		if (!result.ok) {
			if (result.error.kind === "not_found") return c.json(null, 404);
			return c.json({ error: result.error.kind }, 500);
		}
		if (result.value.owner_id !== auth_user.id) return c.json(null, 401);
		return c.json(result.value);
	}

	if (query.name) {
		const result = await projectsD1.getProject(db, auth_user.id, query.name);
		if (!result.ok) {
			if (result.error.kind === "not_found") return c.json(null, 404);
			return c.json({ error: result.error.kind }, 401);
		}
		return c.json(result.value);
	}

	const result = await projectsD1.getUserProjects(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/projects/public", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await projectsD1.getUserProjects(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);

	const public_projects = result.value.filter(p => p.visibility === "PUBLIC");
	return c.json(public_projects);
});

app.patch("/projects", requireAuth, zValidator("json", upsert_project), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	if (data.owner_id && data.owner_id !== auth_user.id) {
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}

	const session = c.get("session");
	const access_token = session?.access_token;

	const github_client: projectsD1.GitHubClient = {
		getRepoMetadata: access_token
			? async (owner: string, repo: string, token: string) => {
					const result = await githubD1.getRepoMetadata(owner, repo, token);
					if (!result.ok) throw new Error("Failed to get repo metadata");
					return result.value;
				}
			: undefined,
		getSpecification: access_token
			? async (owner: string, repo: string, token: string) => {
					const result = await githubD1.getSpecification(owner, repo, token);
					if (!result.ok) throw new Error("Failed to get specification");
					return result.value;
				}
			: undefined,
	};

	const result = await projectsD1.upsertProject(db, data, auth_user.id, access_token ?? undefined, github_client);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "validation_error") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.get("/projects/:project_id/history", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.param("project_id");

	if (!project_id) return c.json({ error: "Missing project_id parameter" }, 400);

	const project_result = await projectsD1.getProjectById(db, project_id);
	if (!project_result.ok) return c.json({ error: project_result.error.kind }, project_result.error.kind === "not_found" ? 404 : 500);
	if (project_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const result = await actionD1.getProjectHistory(db, project_result.value.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/projects/config", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "Missing project_id parameter" }, 400);

	const project_result = await projectsD1.getProjectById(db, project_id);
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

	const tags = Object.values(
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
		config: { tags, ignore: ignore_paths.map(p => p.path) },
		scan_branch: project_result.value.scan_branch ?? "main",
	});
});

app.get("/tasks", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const query = c.req.query();

	if (query.id) {
		const result = await tasksD1.getTask(db, query.id);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		if (!result.value) return c.json(null, 404);
		if (result.value.task.owner_id !== auth_user.id) return c.json(null, 401);
		return c.json(result.value);
	}

	if (query.tag) {
		const result = await tasksD1.getTasksByTag(db, query.tag);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		return c.json(result.value);
	}

	if (query.project) {
		const result = await tasksD1.getProjectTasks(db, query.project);
		if (!result.ok) return c.json({ error: result.error.kind }, 500);
		return c.json(result.value);
	}

	const result = await tasksD1.getUserTasks(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/tasks/history/:task_id", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const task_id = c.req.param("task_id");

	if (!task_id) return c.json({ error: "Missing task_id parameter" }, 400);

	const task_result = await tasksD1.getTask(db, task_id);
	if (!task_result.ok) return c.json({ error: task_result.error.kind }, 500);
	if (!task_result.value) return c.json(null, 404);
	if (task_result.value.task.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const result = await actionD1.getTaskHistory(db, task_id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.patch("/tasks", requireAuth, zValidator("json", upsert_todo), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");
	const body = await c.req.json();

	if (data.owner_id !== auth_user.id) {
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}

	let tags: any[] = [];
	if (body.tags) {
		const tag_parse = save_tags_request.safeParse(body.tags);
		if (!tag_parse.success) return c.json({ error: tag_parse.error.message }, 400);
		tags = tag_parse.data;
	}

	const result = await tasksD1.upsertTask(db, data, tags, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "validation_error") return c.json({ error: result.error.message }, 400);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/tasks/save_tags", requireAuth, zValidator("json", save_tags_request), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	for (const t of data) {
		if (t.owner_id && t.owner_id !== auth_user.id) {
			return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
		}
	}

	const results = await Promise.all(data.map(t => tagsD1.upsertTag(db, t)));
	const failed = results.find(r => !r.ok);
	if (failed && !failed.ok) return c.json({ error: "Error saving tags" }, 500);

	const tag_ids = results.filter(r => r.ok).map(r => r.value);
	if (tag_ids.length !== data.length) return c.json({ error: "Tag upsert returned incorrect rows" }, 500);

	const full_tags = await db.select().from(tag).where(inArray(tag.id, tag_ids));
	return c.json(full_tags);
});

app.get("/tags", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await tagsD1.getActiveUserTags(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/projects/fetch_spec", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "Missing project_id parameter" }, 400);

	const project_result = await projectsD1.getProjectById(db, project_id);
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

	const result = await githubD1.getSpecification(owner, repo, access_token);
	if (!result.ok) return c.json({ error: "Error fetching specification" }, 500);
	return new Response(result.value);
});

app.patch("/projects/save_config", requireAuth, zValidator("json", save_config_request), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	const found_result = await projectsD1.getProjectById(db, data.id);
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
				const tag_result = await tagsD1.upsertTag(db, { owner_id: auth_user.id, title: t.name, deleted: false, color: null, render: true });
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

app.get("/repos", requireAuth, async c => {
	const session = c.get("session");
	if (!session?.access_token) {
		return c.json({ error: "GitHub access token not available. Please re-authenticate with GitHub." }, 401);
	}

	const result = await githubD1.getRepos(session.access_token);
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

	const result = await githubD1.getBranches(db, owner, repo, session.access_token);
	if (!result.ok) return c.json({ error: "Failed to fetch branches" }, 500);
	return c.json(result.value);
});

const create_key_schema = z.object({
	name: z.string().min(1).max(100).optional(),
});

app.get("/auth/keys", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await keysD1.getAPIKeys(db, auth_user.id);
	if (!result.ok) return c.json({ error: "Failed to fetch API keys" }, 500);
	return c.json(result.value);
});

app.post("/auth/keys", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const body = await c.req.json();
	const parsed = create_key_schema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);

	const result = await keysD1.createApiKey(db, auth_user.id);
	if (!result.ok) return c.json({ error: "Failed to create API key" }, 500);

	return c.json({ message: "API key created successfully", key: result.value });
});

app.delete("/auth/keys/:key_id", requireAuth, async c => {
	const db = c.get("db");
	const key_id = c.req.param("key_id");

	if (!key_id) return c.json({ error: "Key ID required" }, 400);

	const result = await keysD1.deleteApiKey(db, key_id);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "API key not found" }, 404);
		return c.json({ error: "Failed to delete API key" }, 500);
	}

	return c.json({ message: "API key deleted successfully", success: true });
});

app.post("/projects/scan", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const session = c.get("session");

	if (!session?.access_token) return c.json({ error: "Authentication required" }, 401);

	const project_id = c.req.query("project_id");
	if (!project_id) return c.json({ error: "project_id parameter required" }, 400);

	return stream(c, async s => {
		try {
			for await (const chunk of scanningD1.initiateScan(db, project_id, auth_user.id, session.access_token!)) {
				await s.write(chunk);
			}
		} catch {
			await s.write("error: scan failed\n");
		}
	});
});

app.get("/projects/updates", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "project_id required" }, 400);

	const result = await scanningD1.getPendingUpdates(db, project_id, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json({ updates: result.value });
});

const scan_status_schema = z.object({
	id: z.number(),
	actions: z.record(z.string(), z.array(z.string())),
	titles: z.record(z.string(), z.string()),
	approved: z.boolean(),
});

app.post("/projects/scan_status", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) return c.json({ error: "project_id parameter required" }, 400);

	const body = await c.req.json();
	const parsed = scan_status_schema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", details: parsed.error }, 400);

	const { id: update_id, actions, titles, approved } = parsed.data;

	const result = await scanningD1.processScanResults(db, project_id, auth_user.id, update_id, actions, titles, approved);
	if (!result.ok) return c.json({ error: result.error.kind }, 400);
	return c.json({ success: true });
});

app.patch("/user/preferences", requireAuth, zValidator("json", update_user), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	if (auth_user.id !== data.id) return c.json({ error: "Forbidden" }, 403);

	const user_result = await usersD1.getUserById(db, auth_user.id);
	if (!user_result.ok) return c.json({ error: user_result.error.kind }, 500);
	if (!user_result.value) return c.json({ error: "User not found" }, 404);

	const update_result = await usersD1.updateUserPreferences(db, auth_user.id, {
		id: auth_user.id,
		task_view: data.task_view,
		name: data.name,
		email_verified: data.email_verified,
	});
	if (!update_result.ok) return c.json({ error: update_result.error.kind }, 500);

	return c.json({
		id: update_result.value.id,
		name: update_result.value.name,
		task_view: update_result.value.task_view,
	});
});

app.get("/user/history", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await actionD1.getUserHistory(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/milestones", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await milestonesD1.getUserMilestones(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/milestones/:id", requireAuth, async c => {
	const db = c.get("db");
	const milestone_id = c.req.param("id");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const result = await milestonesD1.getMilestone(db, milestone_id);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "Milestone not found" }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	if (!result.value) return c.json({ error: "Milestone not found" }, 404);
	return c.json(result.value);
});

app.post("/milestones", requireAuth, zValidator("json", upsert_milestone), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	const result = await milestonesD1.upsertMilestone(db, data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/milestones/:id", requireAuth, zValidator("json", upsert_milestone), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const milestone_id = c.req.param("id");
	const data = c.req.valid("json");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const update_data = { ...data, id: milestone_id };
	const result = await milestonesD1.upsertMilestone(db, update_data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.delete("/milestones/:id", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const milestone_id = c.req.param("id");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const result = await milestonesD1.deleteMilestone(db, milestone_id, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json({ success: true, message: "Milestone deleted" });
});

app.get("/projects/:id/milestones", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const project_id = c.req.param("id");

	if (!project_id) return c.json({ error: "Missing project ID" }, 400);

	const project_result = await projectsD1.getProjectById(db, project_id);
	if (!project_result.ok) {
		if (project_result.error.kind === "not_found") return c.json({ error: "Project not found" }, 404);
		return c.json({ error: project_result.error.kind }, 500);
	}
	if (project_result.value.owner_id !== auth_user.id) return c.json({ error: "Unauthorized" }, 401);

	const result = await milestonesD1.getProjectMilestones(db, project_result.value.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/goals", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;

	const result = await goalsD1.getUserGoals(db, auth_user.id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

app.get("/goals/:id", requireAuth, async c => {
	const db = c.get("db");
	const goal_id = c.req.param("id");

	if (!goal_id) return c.json({ error: "Missing goal ID" }, 400);

	const result = await goalsD1.getGoal(db, goal_id);
	if (!result.ok) {
		if (result.error.kind === "not_found") return c.json({ error: "Goal not found" }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	if (!result.value) return c.json({ error: "Goal not found" }, 404);
	return c.json(result.value);
});

app.post("/goals", requireAuth, zValidator("json", upsert_goal), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const data = c.req.valid("json");

	const result = await goalsD1.upsertGoal(db, data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.patch("/goals/:id", requireAuth, zValidator("json", upsert_goal), async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const goal_id = c.req.param("id");
	const data = c.req.valid("json");

	if (!goal_id) return c.json({ error: "Missing goal ID" }, 400);

	const update_data = { ...data, id: goal_id };
	const result = await goalsD1.upsertGoal(db, update_data, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json(result.value);
});

app.delete("/goals/:id", requireAuth, async c => {
	const db = c.get("db");
	const auth_user = c.get("user")!;
	const goal_id = c.req.param("id");

	if (!goal_id) return c.json({ error: "Missing goal ID" }, 400);

	const result = await goalsD1.deleteGoal(db, goal_id, auth_user.id);
	if (!result.ok) {
		if (result.error.kind === "unauthorized") return c.json({ error: result.error.message }, 401);
		if (result.error.kind === "not_found") return c.json({ error: `${result.error.entity} not found` }, 404);
		return c.json({ error: result.error.kind }, 500);
	}
	return c.json({ success: true, message: "Goal deleted" });
});

app.get("/milestones/:id/goals", requireAuth, async c => {
	const db = c.get("db");
	const milestone_id = c.req.param("id");

	if (!milestone_id) return c.json({ error: "Missing milestone ID" }, 400);

	const milestone_result = await milestonesD1.getMilestone(db, milestone_id);
	if (!milestone_result.ok) {
		if (milestone_result.error.kind === "not_found") return c.json({ error: "Milestone not found" }, 404);
		return c.json({ error: milestone_result.error.kind }, 500);
	}
	if (!milestone_result.value) return c.json({ error: "Milestone not found" }, 404);

	const result = await goalsD1.getMilestoneGoals(db, milestone_id);
	if (!result.ok) return c.json({ error: result.error.kind }, 500);
	return c.json(result.value);
});

export default app;
