import {
	getActiveUserTags,
	getProject,
	getProjectById,
	getProjectTasks,
	getRepos,
	getSpecification,
	getTask,
	getTaskHistory,
	getTasksByTag,
	getUserProjectMap,
	getUserProjects,
	getUserTasks,
	upsertProject,
	upsertTag,
	upsertTask,
	log,
} from "@devpad/core";
import { save_config_request, save_tags_request, upsert_project, upsert_todo } from "@devpad/schema";
import { ignore_path, project, tag, tag_config } from "@devpad/schema/database";
import { db } from "@devpad/schema/database/server";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { type AuthContext, requireAuth } from "../middleware/auth";

const app = new Hono<AuthContext>();

// Index endpoint
app.get("/", c => c.json({ version: "0", status: "ok" }));

// Projects endpoints
app.get("/projects", requireAuth, async c => {
	try {
		const user = c.get("user")!;
		// console.log("DEBUG: User from auth:", user);
		const query = c.req.query();
		// console.log("DEBUG: Query params:", query);

		// Get project by ID
		if (query.id) {
			const { project, error } = await getProjectById(query.id);
			if (error) {
				if (error === "Couldn't find project") {
					return c.json(null, 404);
				}
				return c.json({ error }, 500);
			}
			if (!project) {
				return c.json(null, 404);
			}
			if (project.owner_id !== user.id) {
				return c.json(null, 401);
			}
			return c.json(project);
		}

		// Get project by name
		if (query.name) {
			const { project, error } = await getProject(user.id, query.name);
			if (error) {
				if (error === "Couldn't find project") {
					return c.json(null, 404);
				}
				return c.json({ error }, 401);
			}
			if (!project) {
				return c.json(null, 404);
			}
			return c.json(project);
		}

		// Get all user projects (authenticated user can see all their own projects)
		const projects = await getUserProjects(user.id);
		return c.json(projects);
	} catch (error: any) {
		log.error("GET /projects error:", error);
		return c.json({ error: "Internal Server Error", details: error.message }, 500);
	}
});

// Public projects endpoint - returns only public projects for the authenticated user
app.get("/projects/public", requireAuth, async c => {
	try {
		const user = c.get("user")!;
		const projects = await getUserProjects(user.id);
		const publicProjects = projects.filter(project => project.visibility === "PUBLIC");
		return c.json(publicProjects);
	} catch (error: any) {
		log.error("GET /projects error/public:", error);
		return c.json({ error: "Internal Server Error", details: error.message }, 500);
	}
});

app.patch("/projects", requireAuth, zValidator("json", upsert_project), async c => {
	const user = c.get("user")!;
	const data = c.req.valid("json");

	// Assert that the owner_id matches the authenticated user
	if (data.owner_id && data.owner_id !== user.id) {
		// console.log("Unauthorized: owner_id mismatch", { user_id: user.id, owner_id: data.owner_id });
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}

	try {
		// Get access token from session if available
		const session = c.get("session");
		const access_token = session?.access_token;
		const newProject = await upsertProject(data, user.id, access_token);

		return c.json(newProject);
	} catch (err) {
		console.error(err);
		if (err instanceof Error) {
			if (err.message.includes("Unauthorized")) {
				return c.json({ error: err.message }, 401);
			}
			if (err.message.includes("Bad Request")) {
				return c.json({ error: err.message }, 400);
			}
		}
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

// Tasks endpoints
app.get("/tasks", requireAuth, async c => {
	const user = c.get("user")!;
	const query = c.req.query();

	// Get task by ID
	if (query.id) {
		const task = await getTask(query.id);
		if (!task) {
			return c.json(null, 404);
		}
		if (task.task.owner_id !== user.id) {
			return c.json(null, 401);
		}
		return c.json(task);
	}

	// Get tasks by tag
	if (query.tag) {
		const tasks = await getTasksByTag(query.tag);
		if (!tasks) {
			return c.json(null, 404);
		}
		return c.json(tasks);
	}

	// Get tasks by project
	if (query.project) {
		const tasks = await getProjectTasks(query.project);
		if (!tasks) {
			return c.json(null, 404);
		}
		return c.json(tasks);
	}

	// Get all user tasks
	const tasks = await getUserTasks(user.id);
	return c.json(tasks);
});

// Task history endpoint
app.get("/tasks/history/:task_id", requireAuth, async c => {
	const user = c.get("user")!;
	const task_id = c.req.param("task_id");

	if (!task_id) {
		return c.json({ error: "Missing task_id parameter" }, 400);
	}

	try {
		// First verify the task belongs to the user
		const task = await getTask(task_id);
		if (!task) {
			return c.json(null, 404);
		}
		if (task.task.owner_id !== user.id) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		// Get task history
		const history = await getTaskHistory(task_id);
		return c.json(history);
	} catch (error: any) {
		log.error("GET /tasks error/history:", error);
		return c.json({ error: "Internal Server Error", details: error.message }, 500);
	}
});

app.patch("/tasks", requireAuth, zValidator("json", upsert_todo), async c => {
	const user = c.get("user")!;
	const data = c.req.valid("json");
	const body = await c.req.json();

	// Ensure owner_id matches the authenticated user
	if (data.owner_id !== user.id) {
		return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
	}

	let tags: any[] = [];
	if (body.tags) {
		const tag_parse = save_tags_request.safeParse(body.tags);
		if (!tag_parse.success) {
			console.warn(tag_parse.error);
			return c.json({ error: tag_parse.error.message }, 400);
		}
		tags = tag_parse.data;
	}

	try {
		const newTodo = await upsertTask(data, tags, user.id);
		return c.json(newTodo);
	} catch (err) {
		console.error("Error upserting todo", err);
		if (err instanceof Error) {
			if (err.message.includes("Unauthorized")) {
				return c.json({ error: err.message }, 401);
			}
			if (err.message.includes("Bad Request")) {
				return c.json({ error: err.message }, 400);
			}
		}
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

app.patch("/tasks/save_tags", requireAuth, zValidator("json", save_tags_request), async c => {
	const user = c.get("user")!;
	const data = c.req.valid("json");

	// Ensure all tags belong to the authenticated user
	for (const tag_data of data) {
		if (tag_data.owner_id !== user.id) {
			return c.json({ error: "Unauthorized: owner_id mismatch" }, 401);
		}
	}

	try {
		// Use promises to upsert tags
		const promises = data.map(upsertTag);
		const tag_ids = await Promise.all(promises);

		if (tag_ids.length !== data.length) {
			throw new Error(`Tag upsert returned incorrect rows (${tag_ids.length})`);
		}

		// Fetch the full tag objects to return complete data
		const full_tags = await db.select().from(tag).where(inArray(tag.id, tag_ids));
		return c.json(full_tags);
	} catch (err) {
		console.error("Error saving tags:", err);
		return c.json({ error: "Error saving tags" }, 500);
	}
});

// Tags endpoints
app.get("/tags", requireAuth, async c => {
	try {
		const user = c.get("user")!;
		const tags = await getActiveUserTags(user.id);
		return c.json(tags);
	} catch (error: any) {
		log.error("GET /tags error:", error);
		return c.json({ error: "Internal Server Error", details: error.message }, 500);
	}
});

// Projects Map endpoint (for convenience)
app.get("/projects/map", requireAuth, async c => {
	try {
		const user = c.get("user")!;
		const projectMap = await getUserProjectMap(user.id);
		return c.json(projectMap);
	} catch (error: any) {
		log.error("GET /projects error/map:", error);
		return c.json({ error: "Internal Server Error", details: error.message }, 500);
	}
});

// Project-specific endpoints
app.get("/projects/fetch_spec", requireAuth, async c => {
	const user = c.get("user")!;
	const project_id = c.req.query("project_id");

	if (!project_id) {
		return c.json({ error: "Missing project_id parameter" }, 400);
	}

	try {
		const { project, error } = await getProjectById(project_id);
		if (error) return c.json({ error }, 500);
		if (!project) return c.json({ error: "Project not found" }, 404);
		if (project.owner_id !== user.id) return c.json({ error: "Unauthorized" }, 401);

		const repo_url = project.repo_url;
		if (!repo_url) return c.json({ error: "Project has no repo_url" }, 400);

		const slices = repo_url.split("/");
		const repo = slices.at(-1);
		const owner = slices.at(-2);
		if (!repo || !owner) return c.json({ error: "Invalid repo_url" }, 400);

		const session = c.get("session");
		const access_token = session?.access_token;
		if (!access_token) return c.json({ error: "GitHub access token required" }, 401);

		const readme = await getSpecification(owner, repo, access_token);
		return new Response(readme);
	} catch (err) {
		console.error(`fetch_spec: `, err);
		return c.json({ error: "Error fetching specification" }, 500);
	}
});

app.patch("/projects/save_config", requireAuth, zValidator("json", save_config_request), async c => {
	const user = c.get("user")!;
	const data = c.req.valid("json");

	// Verify project ownership
	const { project: found, error } = await getProjectById(data.id);
	if (error) return c.json({ error }, 500);
	if (!found) return c.json({ error: "Project not found" }, 404);
	if (found.owner_id !== user.id) return c.json({ error: "Unauthorized" }, 401);

	try {
		// Get current tags
		const current_tags = await db.select({ id: tag_config.tag_id }).from(tag_config).where(eq(tag_config.project_id, data.id));

		// Upsert Tags
		let tag_ids: string[] = [];
		if (data.config.tags.length > 0) {
			const tag_promises = data.config.tags.map(async tag => {
				const tag_id = await upsertTag({ owner_id: user.id, title: tag.name, deleted: false, color: null, render: true });

				// Upsert tag matches into `tag_config`
				const current_matches = await db
					.select({ match: tag_config.match })
					.from(tag_config)
					.where(and(eq(tag_config.project_id, data.id), eq(tag_config.tag_id, tag_id)));

				const current_match_set = new Set(current_matches.map(match => match.match));
				const new_matches = tag.match.filter(m => !current_match_set.has(m));

				// Insert new matches
				if (new_matches.length > 0) {
					const values = new_matches.map(match => ({ project_id: data.id, tag_id: tag_id, match: match }));
					await db.insert(tag_config).values(values);
				}

				// Remove old matches not in the current configuration
				const matches_to_remove = current_matches.filter(m => !tag.match.includes(m.match)).map(m => m.match);

				if (matches_to_remove.length > 0) {
					await db.delete(tag_config).where(and(eq(tag_config.project_id, data.id), eq(tag_config.tag_id, tag_id), inArray(tag_config.match, matches_to_remove)));
				}

				return tag_id;
			});

			tag_ids = await Promise.all(tag_promises);
		}

		// Remove any old tags that aren't in tag_ids
		const tags_to_remove = current_tags.filter(t => !tag_ids.includes(t.id)).map(t => t.id);

		if (tags_to_remove.length > 0) {
			await db.delete(tag_config).where(and(eq(tag_config.project_id, data.id), inArray(tag_config.tag_id, tags_to_remove)));
		}

		// Upsert Ignore Paths
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
			await db.update(project).set({ scan_branch: data.scan_branch! }).where(eq(project.id, data.id));
		}

		return c.json(null, 200);
	} catch (err) {
		console.error("Error saving configuration:", err);
		return c.json({ error: "Error saving configuration" }, 500);
	}
});

// GitHub repositories endpoint
app.get("/repos", requireAuth, async c => {
	try {
		const user = c.get("user");
		const session = c.get("session");

		log.repos(" Request details:", {
			hasUser: !!user,
			hasSession: !!session,
			hasAccessToken: !!session?.access_token,
			userId: user?.id,
		});

		// Check if we have a session with access token
		if (!session?.access_token) {
			log.error(" No GitHub access token available in session");
			return c.json({ error: "GitHub access token not available. Please re-authenticate with GitHub." }, 401);
		}

		log.repos(" Fetching repositories from GitHub API");
		// Get repositories using the stored GitHub access token
		const repos = await getRepos(session.access_token);
		log.repos(" Successfully fetched", repos.length, "repositories");
		return c.json(repos);
	} catch (error: any) {
		log.error(" ERROR fetching repositories:", error.message);
		return c.json({ error: "Failed to fetch repositories", details: error.message }, 500);
	}
});

export default app;
