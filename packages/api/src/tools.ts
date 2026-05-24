import { RUN_STATUSES } from "@devpad/schema/database/schema";
import { save_config_request, save_tags_request, upsert_goal, upsert_milestone, upsert_project, upsert_todo } from "@devpad/schema/validation";
import { z } from "zod";
import type { ApiClient } from "./api-client";

function unwrap<T>(result: { ok: boolean; value?: T; error?: { message: string } }): T {
	if (!result.ok) throw new Error(result.error?.message ?? "Unknown error");
	return result.value as T;
}

// Filter schemas that aren't in @devpad/schema yet
export const project_filters = z.object({
	private: z.boolean().optional().describe("Include private projects (default: true)"),
});

export const project_by_id_or_name = z
	.object({
		id: z.string().optional().describe("Project ID"),
		name: z.string().optional().describe("Project name"),
	})
	.refine(data => data.id || data.name, {
		message: "Either 'id' or 'name' must be provided",
	});

export const task_filters = z.object({
	project_id: z.string().optional().describe("Filter by project ID"),
	tag_id: z.string().optional().describe("Filter by tag ID"),
});

export const task_by_id = z.object({
	id: z.string().describe("Task ID"),
});

export const milestone_filters = z.object({
	project_id: z.string().optional().describe("Filter by project ID"),
});

export const milestone_by_id = z.object({
	id: z.string().describe("Milestone ID"),
});

export const goal_by_id = z.object({
	id: z.string().describe("Goal ID"),
});

export const github_branches = z.object({
	owner: z.string().describe("Repository owner"),
	repo: z.string().describe("Repository name"),
});

// Tool metadata type
export interface ToolDefinition<TInput = any, TOutput = any> {
	name: string;
	description: string;
	inputSchema: z.ZodType<TInput>;
	execute: (client: ApiClient, input: TInput) => Promise<TOutput>;
}

// Tool definitions
export const tools: Record<string, ToolDefinition> = {
	// Projects
	devpad_projects_list: {
		name: "devpad_projects_list",
		description: "List all projects (or only public ones)",
		inputSchema: project_filters,
		execute: async (client, input) => unwrap(await client.projects.list(input)),
	},

	devpad_projects_get: {
		name: "devpad_projects_get",
		description: "Get project by ID or name",
		inputSchema: project_by_id_or_name,
		execute: async (client, input) => unwrap(input.id ? await client.projects.getById(input.id) : await client.projects.getByName(input.name!)),
	},

	devpad_projects_upsert: {
		name: "devpad_projects_upsert",
		description: "Create or update a project (set deleted=true to delete). Returns 409 if entity is protected by user - pass force=true to override.",
		inputSchema: upsert_project,
		execute: async (client, input) => unwrap(await client.projects.upsert(input)),
	},

	devpad_projects_config_save: {
		name: "devpad_projects_config_save",
		description: "Save project configuration",
		inputSchema: save_config_request,
		execute: async (client, input) => {
			unwrap(await client.projects.config.save(input));
			return { success: true };
		},
	},

	// Tasks
	devpad_tasks_list: {
		name: "devpad_tasks_list",
		description: "List tasks, optionally filtered by project or tag",
		inputSchema: task_filters,
		execute: async (client, input) => unwrap(await client.tasks.list(input)),
	},

	devpad_tasks_get: {
		name: "devpad_tasks_get",
		description: "Get task by ID",
		inputSchema: task_by_id,
		execute: async (client, input) => unwrap(await client.tasks.find(input.id)),
	},

	devpad_tasks_upsert: {
		name: "devpad_tasks_upsert",
		description: "Create or update a task (set deleted=true to delete). Returns 409 if entity is protected by user - pass force=true to override.",
		inputSchema: upsert_todo,
		execute: async (client, input) => unwrap(await client.tasks.upsert(input)),
	},

	devpad_tasks_save_tags: {
		name: "devpad_tasks_save_tags",
		description: "Save tags for tasks",
		inputSchema: save_tags_request,
		execute: async (client, input) => {
			unwrap(await client.tasks.saveTags(input));
			return { success: true };
		},
	},

	// Milestones
	devpad_milestones_list: {
		name: "devpad_milestones_list",
		description: "List milestones for authenticated user or by project",
		inputSchema: milestone_filters,
		execute: async (client, input) => unwrap(input.project_id ? await client.milestones.getByProject(input.project_id) : await client.milestones.list()),
	},

	devpad_milestones_get: {
		name: "devpad_milestones_get",
		description: "Get milestone by ID",
		inputSchema: milestone_by_id,
		execute: async (client, input) => unwrap(await client.milestones.find(input.id)),
	},

	devpad_milestones_upsert: {
		name: "devpad_milestones_upsert",
		description: "Create or update a milestone. Returns 409 if entity is protected by user - pass force=true to override.",
		inputSchema: upsert_milestone,
		execute: async (client, input) =>
			unwrap(
				input.id
					? await client.milestones.update(input.id, {
							name: input.name,
							description: input.description,
							target_time: input.target_time,
							target_version: input.target_version,
							finished_at: input.finished_at,
						})
					: await client.milestones.create({
							project_id: input.project_id,
							name: input.name,
							description: input.description,
							target_time: input.target_time,
							target_version: input.target_version,
							finished_at: input.finished_at,
						})
			),
	},

	// Goals
	devpad_goals_list: {
		name: "devpad_goals_list",
		description: "List goals for authenticated user",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.goals.list()),
	},

	devpad_goals_get: {
		name: "devpad_goals_get",
		description: "Get goal by ID",
		inputSchema: goal_by_id,
		execute: async (client, input) => unwrap(await client.goals.find(input.id)),
	},

	devpad_goals_upsert: {
		name: "devpad_goals_upsert",
		description: "Create or update a goal. Returns 409 if entity is protected by user - pass force=true to override.",
		inputSchema: upsert_goal,
		execute: async (client, input) =>
			unwrap(
				input.id
					? await client.goals.update(input.id, {
							name: input.name,
							description: input.description,
							target_time: input.target_time,
							finished_at: input.finished_at,
						})
					: await client.goals.create({
							milestone_id: input.milestone_id,
							name: input.name,
							description: input.description,
							target_time: input.target_time,
							finished_at: input.finished_at,
						})
			),
	},

	// Tags
	devpad_tags_list: {
		name: "devpad_tags_list",
		description: "List tags for authenticated user",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.tags.list()),
	},

	// GitHub integration
	devpad_github_repos: {
		name: "devpad_github_repos",
		description: "List GitHub repositories for authenticated user",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.github.repos()),
	},

	devpad_github_branches: {
		name: "devpad_github_branches",
		description: "List branches for a GitHub repository",
		inputSchema: github_branches,
		execute: async (client, input) => unwrap(await client.github.branches(input.owner, input.repo)),
	},

	// Additional project operations
	devpad_projects_delete: {
		name: "devpad_projects_delete",
		description: "Delete a project",
		inputSchema: z.object({
			id: z.string().describe("Project ID"),
		}),
		execute: async (client, input) => {
			const project = unwrap(await client.projects.find(input.id));
			if (!project) throw new Error(`Project ${input.id} not found`);
			unwrap(await client.projects.deleteProject(project));
			return { success: true };
		},
	},

	devpad_projects_history: {
		name: "devpad_projects_history",
		description: "Get project history",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
		}),
		execute: async (client, input) => unwrap(await client.projects.history(input.project_id)),
	},

	devpad_projects_specification: {
		name: "devpad_projects_specification",
		description: "Fetch project specification from GitHub",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
		}),
		execute: async (client, input) => unwrap(await client.projects.specification(input.project_id)),
	},

	devpad_projects_config_load: {
		name: "devpad_projects_config_load",
		description: "Load project configuration",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
		}),
		execute: async (client, input) => unwrap(await client.projects.config.load(input.project_id)),
	},

	// Additional milestone operations
	devpad_milestones_delete: {
		name: "devpad_milestones_delete",
		description: "Delete a milestone",
		inputSchema: z.object({
			id: z.string().describe("Milestone ID"),
		}),
		execute: async (client, input) => unwrap(await client.milestones.delete(input.id)),
	},

	devpad_milestones_goals: {
		name: "devpad_milestones_goals",
		description: "Get goals for a milestone",
		inputSchema: z.object({
			id: z.string().describe("Milestone ID"),
		}),
		execute: async (client, input) => unwrap(await client.milestones.goals(input.id)),
	},

	// Additional goal operations
	devpad_goals_delete: {
		name: "devpad_goals_delete",
		description: "Delete a goal",
		inputSchema: z.object({
			id: z.string().describe("Goal ID"),
		}),
		execute: async (client, input) => unwrap(await client.goals.delete(input.id)),
	},

	// Additional task operations
	devpad_tasks_delete: {
		name: "devpad_tasks_delete",
		description: "Delete a task",
		inputSchema: z.object({
			id: z.string().describe("Task ID"),
		}),
		execute: async (client, input) => {
			const task = unwrap(await client.tasks.find(input.id));
			if (!task) throw new Error(`Task ${input.id} not found`);
			unwrap(await client.tasks.deleteTask(task));
			return { success: true };
		},
	},

	devpad_tasks_history: {
		name: "devpad_tasks_history",
		description: "Get task history",
		inputSchema: z.object({
			task_id: z.string().describe("Task ID"),
		}),
		execute: async (client, input) => unwrap(await client.tasks.history.get(input.task_id)),
	},

	// User operations
	devpad_user_history: {
		name: "devpad_user_history",
		description: "Get user activity history",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.user.history()),
	},

	devpad_user_preferences: {
		name: "devpad_user_preferences",
		description: "Update user preferences",
		inputSchema: z.object({
			id: z.string().describe("User ID"),
			task_view: z.enum(["list", "grid"]).describe("Task view preference"),
		}),
		execute: async (client, input) => unwrap(await client.user.preferences(input)),
	},

	devpad_activity_ai: {
		name: "devpad_activity_ai",
		description: "Get AI activity feed - shows recent actions made via API/MCP grouped into sessions by time window",
		inputSchema: z.object({
			limit: z.number().optional().describe("Max sessions to return (default 20)"),
			since: z.string().optional().describe("Only show activity after this ISO date"),
		}),
		execute: async (client, input) => unwrap(await client.activity.ai(input)),
	},

	devpad_blog_posts_list: {
		name: "devpad_blog_posts_list",
		description: "List blog posts with optional filters",
		inputSchema: z.object({
			category: z.string().optional().describe("Filter by category"),
			tag: z.string().optional().describe("Filter by tag"),
			project: z.string().optional().describe("Filter by project ID"),
			status: z.enum(["draft", "published"]).optional().describe("Filter by status"),
			archived: z.boolean().optional().describe("Filter by archived state"),
			limit: z.number().optional().describe("Max posts to return"),
			offset: z.number().optional().describe("Offset for pagination"),
			sort: z.string().optional().describe("Sort order"),
		}),
		execute: async (client, input) => unwrap(await client.blog.posts.list(input)),
	},

	devpad_blog_posts_get: {
		name: "devpad_blog_posts_get",
		description: "Get a blog post by slug",
		inputSchema: z.object({
			slug: z.string().describe("Post slug"),
		}),
		execute: async (client, input) => unwrap(await client.blog.posts.getBySlug(input.slug)),
	},

	devpad_blog_posts_create: {
		name: "devpad_blog_posts_create",
		description: "Create a new blog post",
		inputSchema: z.object({
			title: z.string().describe("Post title"),
			content: z.string().describe("Post content"),
			format: z.enum(["markdown", "html"]).describe("Content format"),
			slug: z.string().optional().describe("Custom slug"),
			category: z.string().optional().describe("Category name"),
			tags: z.array(z.string()).optional().describe("Tag names"),
			description: z.string().optional().describe("Post description"),
			publish_at: z.string().optional().describe("Scheduled publish date (ISO string)"),
			project_ids: z.array(z.string()).optional().describe("Associated project IDs"),
			archived: z.boolean().optional().describe("Whether post is archived"),
		}),
		execute: async (client, input) => unwrap(await client.blog.posts.create(input)),
	},

	devpad_blog_posts_update: {
		name: "devpad_blog_posts_update",
		description: "Update a blog post by UUID",
		inputSchema: z.object({
			uuid: z.string().describe("Post UUID"),
			title: z.string().optional().describe("Post title"),
			content: z.string().optional().describe("Post content"),
			format: z.enum(["markdown", "html"]).optional().describe("Content format"),
			slug: z.string().optional().describe("Custom slug"),
			category: z.string().optional().describe("Category name"),
			tags: z.array(z.string()).optional().describe("Tag names"),
			description: z.string().optional().describe("Post description"),
			publish_at: z.string().optional().describe("Scheduled publish date (ISO string)"),
			project_ids: z.array(z.string()).optional().describe("Associated project IDs"),
			archived: z.boolean().optional().describe("Whether post is archived"),
		}),
		execute: async (client, input) => {
			const { uuid, ...data } = input;
			return unwrap(await client.blog.posts.update(uuid, data));
		},
	},

	devpad_blog_posts_delete: {
		name: "devpad_blog_posts_delete",
		description: "Delete a blog post by UUID",
		inputSchema: z.object({
			uuid: z.string().describe("Post UUID"),
		}),
		execute: async (client, input) => unwrap(await client.blog.posts.delete(input.uuid)),
	},

	devpad_blog_tags_list: {
		name: "devpad_blog_tags_list",
		description: "List all blog tags with post counts",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.blog.tags.list()),
	},

	devpad_blog_categories_tree: {
		name: "devpad_blog_categories_tree",
		description: "Get the blog category tree",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.blog.categories.tree()),
	},

	devpad_blog_categories_create: {
		name: "devpad_blog_categories_create",
		description: "Create a blog category",
		inputSchema: z.object({
			name: z.string().describe("Category name"),
			parent: z.string().optional().describe("Parent category name"),
		}),
		execute: async (client, input) => unwrap(await client.blog.categories.create(input)),
	},

	devpad_blog_tokens_list: {
		name: "devpad_blog_tokens_list",
		description: "List blog access tokens",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.blog.tokens.list()),
	},

	devpad_blog_tokens_create: {
		name: "devpad_blog_tokens_create",
		description: "Create a blog access token",
		inputSchema: z.object({
			name: z.string().describe("Token name"),
			note: z.string().optional().describe("Optional note"),
		}),
		execute: async (client, input) => unwrap(await client.blog.tokens.create(input)),
	},

	devpad_media_profiles_list: {
		name: "devpad_media_profiles_list",
		description: "List media profiles",
		inputSchema: z.object({}),
		execute: async client => unwrap(await client.media.profiles.list()),
	},

	devpad_media_profiles_create: {
		name: "devpad_media_profiles_create",
		description: "Create a media profile",
		inputSchema: z.object({
			name: z.string().describe("Profile name"),
			slug: z.string().describe("Profile slug"),
		}),
		execute: async (client, input) => unwrap(await client.media.profiles.create(input)),
	},

	devpad_media_profiles_get: {
		name: "devpad_media_profiles_get",
		description: "Get a media profile by ID",
		inputSchema: z.object({
			id: z.string().describe("Profile ID"),
		}),
		execute: async (client, input) => unwrap(await client.media.profiles.get(input.id)),
	},

	devpad_media_profiles_update: {
		name: "devpad_media_profiles_update",
		description: "Update a media profile by ID",
		inputSchema: z.object({
			id: z.string().describe("Profile ID"),
			name: z.string().optional().describe("Profile name"),
			slug: z.string().optional().describe("Profile slug"),
		}),
		execute: async (client, input) => {
			const { id, ...data } = input;
			return unwrap(await client.media.profiles.update(id, data));
		},
	},

	devpad_media_profiles_delete: {
		name: "devpad_media_profiles_delete",
		description: "Delete a media profile by ID",
		inputSchema: z.object({
			id: z.string().describe("Profile ID"),
		}),
		execute: async (client, input) => unwrap(await client.media.profiles.delete(input.id)),
	},

	devpad_media_connections_list: {
		name: "devpad_media_connections_list",
		description: "List connections for a media profile",
		inputSchema: z.object({
			profile_id: z.string().describe("Profile ID"),
		}),
		execute: async (client, input) => unwrap(await client.media.connections.list(input.profile_id)),
	},

	devpad_media_connections_refresh: {
		name: "devpad_media_connections_refresh",
		description: "Refresh a media connection",
		inputSchema: z.object({
			account_id: z.string().describe("Account/connection ID"),
		}),
		execute: async (client, input) => unwrap(await client.media.connections.refresh(input.account_id)),
	},

	devpad_media_timeline_get: {
		name: "devpad_media_timeline_get",
		description: "Get media timeline for a user",
		inputSchema: z.object({
			user_id: z.string().describe("User ID"),
			from: z.string().optional().describe("Start date (ISO string)"),
			to: z.string().optional().describe("End date (ISO string)"),
		}),
		execute: async (client, input) => {
			const { user_id, ...params } = input;
			return unwrap(await client.media.timeline.get(user_id, params));
		},
	},

	// Pulse analytics tools
	devpad_pulse_summary: {
		name: "devpad_pulse_summary",
		description: "Get summary analytics for a project (pageviews, sessions, errors, latency)",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			range: z.enum(["24h", "7d", "30d", "90d"]).describe("Time range"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.summary({ project_id: input.project_id, range: input.range })),
	},

	devpad_pulse_events: {
		name: "devpad_pulse_events",
		description: "List events for a project with optional filtering",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			name: z.string().optional().describe("Event name filter (pageview, error, log, etc)"),
			level: z.string().optional().describe("Log level filter (debug, info, warn, error, critical)"),
			ts_from: z.number().optional().describe("Start timestamp (unix ms)"),
			ts_to: z.number().optional().describe("End timestamp (unix ms)"),
			search: z.string().optional().describe("Search substring in event properties"),
			limit: z.number().optional().describe("Max events to return (max 500)"),
			cursor: z.string().optional().describe("Pagination cursor"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.events(input)),
	},

	devpad_pulse_errors: {
		name: "devpad_pulse_errors",
		description: "List error issues for a project, optionally grouped by fingerprint",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			range: z.enum(["24h", "7d", "30d", "90d"]).describe("Time range"),
			group_by_fingerprint: z.boolean().optional().describe("Group by error fingerprint (true) or list all (false)"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.errors({ project_id: input.project_id, range: input.range, group_by_fingerprint: input.group_by_fingerprint })),
	},

	devpad_pulse_logs: {
		name: "devpad_pulse_logs",
		description: "List logs for a project with optional level and message filtering",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			range: z.enum(["24h", "7d", "30d", "90d"]).describe("Time range"),
			level: z.string().optional().describe("Log level filter"),
			search: z.string().optional().describe("Search in log messages"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.logs(input)),
	},

	devpad_pulse_latency: {
		name: "devpad_pulse_latency",
		description: "Get request latency metrics (p50, p95, p99) for a project",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			range: z.enum(["24h", "7d", "30d", "90d"]).describe("Time range"),
			route: z.string().optional().describe("Filter by HTTP route"),
			percentiles: z.array(z.number()).optional().describe("Percentiles to compute (default [50, 95, 99])"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.latency(input)),
	},

	devpad_alerts_list: {
		name: "devpad_alerts_list",
		description: "List notification subscriptions (alerts) for a project",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.subs.list(input)),
	},

	devpad_alerts_subscribe: {
		name: "devpad_alerts_subscribe",
		description: "Create a new notification subscription (alert) for events",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			name: z.string().describe("Subscription name"),
			filter: z.record(z.any()).describe("Event filter (name, level, url_pattern, properties)"),
			channel: z.record(z.any()).describe("Notification channel (kind + config: discord, ntfy, email)"),
			cooldown_seconds: z.number().optional().describe("Cooldown between notifications (default 60)"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.subs.create(input)),
	},

	devpad_alerts_unsubscribe: {
		name: "devpad_alerts_unsubscribe",
		description: "Delete a notification subscription by ID",
		inputSchema: z.object({
			id: z.string().describe("Subscription ID"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.subs.delete(input.id)),
	},

	devpad_pulse_key_create: {
		name: "devpad_pulse_key_create",
		description: "Create a new ingest key for a project (returns plaintext once)",
		inputSchema: z.object({
			project_id: z.string().describe("Project ID"),
			name: z.string().optional().describe("Key name/label"),
			rate_limit_per_min: z.number().optional().describe("Rate limit in requests per minute (default 600)"),
		}),
		execute: async (client, input) => unwrap(await client.pulse.keys.create(input)),
	},

	devpad_pipelines_list: {
		name: "devpad_pipelines_list",
		description: "List pipeline runs (newest first). Optionally filter by package and/or status; cap limit at 200.",
		inputSchema: z.object({
			package_id: z.string().optional().describe("Filter runs to a specific package"),
			status: z.enum(RUN_STATUSES).optional().describe("Filter by run status"),
			limit: z.number().int().positive().max(200).optional().describe("Max rows to return (default 50, cap 200)"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.list(input)),
	},

	devpad_pipelines_get: {
		name: "devpad_pipelines_get",
		description: "Get a pipeline run by ID",
		inputSchema: z.object({
			run_id: z.string().describe("Pipeline run ID"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.get(input.run_id)),
	},

	devpad_pipelines_create: {
		name: "devpad_pipelines_create",
		description: "Create a new pipeline run",
		inputSchema: z.object({
			package_id: z.string().describe("Package ID"),
			version_set_id: z.string().describe("Version set ID to deploy"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.create(input)),
	},

	devpad_pipelines_approve: {
		name: "devpad_pipelines_approve",
		description: "Approve or deny a stage in a pipeline run",
		inputSchema: z.object({
			run_id: z.string().describe("Pipeline run ID"),
			stage_name: z.string().describe("Stage name to approve"),
			decision: z.enum(["approved", "denied"]).describe("Approval decision"),
			user_id: z.string().describe("User ID making the decision"),
			reason: z.string().optional().describe("Optional reason for the decision"),
		}),
		execute: async (client, input) => {
			unwrap(await client.pipelines.approve(input.run_id, input));
			return { success: true };
		},
	},

	devpad_pipelines_cancel: {
		name: "devpad_pipelines_cancel",
		description: "Cancel a pipeline run",
		inputSchema: z.object({
			run_id: z.string().describe("Pipeline run ID"),
		}),
		execute: async (client, input) => {
			unwrap(await client.pipelines.cancel(input.run_id));
			return { success: true };
		},
	},

	devpad_pipelines_rollback: {
		name: "devpad_pipelines_rollback",
		description: "Rollback a completed or failed pipeline run",
		inputSchema: z.object({
			run_id: z.string().describe("Pipeline run ID"),
		}),
		execute: async (client, input) => {
			unwrap(await client.pipelines.rollback(input.run_id));
			return { success: true };
		},
	},

	devpad_pipelines_grants_list: {
		name: "devpad_pipelines_grants_list",
		description: "List vault grants for a pipeline package",
		inputSchema: z.object({
			package_id: z.string().describe("Package ID to filter grants by"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.grants.list(input.package_id)),
	},

	devpad_pipelines_grants_approve: {
		name: "devpad_pipelines_grants_approve",
		description: "Approve a pending vault grant request for a pipeline package",
		inputSchema: z.object({
			grant_id: z.string().describe("Grant ID to approve"),
			user_id: z.string().describe("User ID making the approval decision"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.grants.approve(input.grant_id, input.user_id)),
	},

	devpad_pipelines_grants_deny: {
		name: "devpad_pipelines_grants_deny",
		description: "Deny a pending vault grant request for a pipeline package",
		inputSchema: z.object({
			grant_id: z.string().describe("Grant ID to deny"),
			user_id: z.string().describe("User ID making the denial decision"),
			reason: z.string().optional().describe("Optional reason for the denial"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.grants.deny(input.grant_id, input.user_id, input.reason)),
	},

	devpad_pipelines_packages_list: {
		name: "devpad_pipelines_packages_list",
		description: "List pipeline packages. Optionally filter by linked devpad project_id; unlinked packages have project_id = null.",
		inputSchema: z.object({
			project_id: z.string().optional().describe("Filter packages by linked devpad project"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.packages.list(input)),
	},

	devpad_pipelines_packages_get: {
		name: "devpad_pipelines_packages_get",
		description: "Get a pipeline package by ID",
		inputSchema: z.object({
			package_id: z.string().describe("Pipeline package ID"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.packages.get(input.package_id)),
	},

	devpad_pipelines_packages_create: {
		name: "devpad_pipelines_packages_create",
		description: "Register a new pipeline-managed package. By convention `id` equals the package `name`. `project_id` optionally links the package to a devpad project.",
		inputSchema: z.object({
			id: z.string().describe("Canonical package ID (typically the same as name)"),
			name: z.string().describe("Package name"),
			owner_id: z.string().describe("User ID of the owner"),
			repo_url: z.string().optional().describe("Optional git repo URL"),
			project_id: z.string().optional().describe("Optional devpad project ID to link"),
			default_template_ref: z.string().optional().describe("Optional default pipeline template ref"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.packages.create(input)),
	},

	devpad_pipelines_packages_update: {
		name: "devpad_pipelines_packages_update",
		description: "Partially update a pipeline package. Only the provided fields are touched.",
		inputSchema: z.object({
			id: z.string().describe("Pipeline package ID"),
			repo_url: z.string().nullable().optional(),
			project_id: z.string().nullable().optional(),
			default_template_ref: z.string().nullable().optional(),
			script_name_overrides: z.record(z.string(), z.string()).nullable().optional(),
		}),
		execute: async (client, input) => {
			const { id, ...patch } = input;
			return unwrap(await client.pipelines.packages.update(id, patch));
		},
	},

	devpad_pipelines_packages_delete: {
		name: "devpad_pipelines_packages_delete",
		description: "Delete a pipeline package. Refuses with conflict if existing pipeline_run rows still reference the package.",
		inputSchema: z.object({
			id: z.string().describe("Pipeline package ID"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.packages.delete(input.id)),
	},

	devpad_pipelines_analysis_templates_list: {
		name: "devpad_pipelines_analysis_templates_list",
		description: "List pipeline analysis templates for an owner. Each row encodes the threshold DSL + window referenced by analysis-gate evaluations.",
		inputSchema: z.object({
			owner_id: z.string().describe("Devpad user ID whose templates to list"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.analysis_templates.list(input)),
	},

	devpad_pipelines_analysis_templates_get: {
		name: "devpad_pipelines_analysis_templates_get",
		description: "Get a single pipeline analysis template by id, scoped to its owner.",
		inputSchema: z.object({
			id: z.string().describe("Pipeline analysis template ID"),
			owner_id: z.string().describe("Owner ID (must match the template's owner)"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.analysis_templates.get(input.id, { owner_id: input.owner_id })),
	},

	devpad_pipelines_analysis_templates_create: {
		name: "devpad_pipelines_analysis_templates_create",
		description:
			'Create a new pipeline analysis template. `threshold_dsl` is a multi-line DSL: `metric_name OP value [: pending]` (OPs: > < >= <= =). Trailing ": pending" marks a breach as Pending rather than Fail. Server-side parse failure surfaces as `validation_error` with field=threshold_dsl. `window_ms` defaults to 600000 (10 min).',
		inputSchema: z.object({
			owner_id: z.string().describe("Devpad user ID who owns this template"),
			name: z.string().describe("Human-readable name (e.g. \"default-analysis\")"),
			threshold_dsl: z.string().describe("Multi-line threshold DSL"),
			query_dsl: z.unknown().optional().describe("Optional structured query DSL stored alongside thresholds"),
			window_ms: z.number().int().positive().optional().describe("Analysis window in milliseconds. Default: 600000"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.analysis_templates.create(input)),
	},

	devpad_pipelines_analysis_templates_update: {
		name: "devpad_pipelines_analysis_templates_update",
		description: "Partially update a pipeline analysis template. Only the supplied fields are touched. Re-validates threshold_dsl when present.",
		inputSchema: z.object({
			id: z.string().describe("Pipeline analysis template ID"),
			owner_id: z.string().describe("Owner ID (must match the template's owner)"),
			name: z.string().optional(),
			threshold_dsl: z.string().optional(),
			query_dsl: z.unknown().optional(),
			window_ms: z.number().int().positive().optional(),
		}),
		execute: async (client, input) => {
			const { id, ...patch } = input;
			return unwrap(await client.pipelines.analysis_templates.update(id, patch));
		},
	},

	devpad_pipelines_analysis_templates_delete: {
		name: "devpad_pipelines_analysis_templates_delete",
		description: "Hard-delete a pipeline analysis template. Does NOT consult pipeline_run.resolved_gates — runs snapshot their gate template at resolve-time, so deletion never orphans in-flight runs.",
		inputSchema: z.object({
			id: z.string().describe("Pipeline analysis template ID"),
			owner_id: z.string().describe("Owner ID (must match the template's owner)"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.analysis_templates.delete(input.id, { owner_id: input.owner_id })),
	},

	devpad_pipelines_oidc_trust_list: {
		name: "devpad_pipelines_oidc_trust_list",
		description: "List GitHub Actions OIDC trust policies for an owner. Returned ordered by created_at DESC, id ASC to match the orchestrator's trust-matcher resolution order.",
		inputSchema: z.object({
			owner_id: z.string().describe("User ID whose trust policies to list"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.oidc_trust.list(input)),
	},

	devpad_pipelines_oidc_trust_create: {
		name: "devpad_pipelines_oidc_trust_create",
		description: "Create a GitHub Actions OIDC trust policy. Authorises CI in repos owned by `github_owner` (filtered by `repo_pattern` and optional ref/environment lists) to mint orchestrator session tokens. Defaults: repo_pattern=\"*\", allowed_actions=[\"artifacts:upload\",\"runs:start\"], session_ttl_seconds=900.",
		inputSchema: z.object({
			owner_id: z.string().describe("Devpad user ID who owns this policy"),
			github_owner: z.string().describe("GitHub `repository_owner` claim to trust (e.g. \"f0rbit\")"),
			expected_audience: z.string().describe("Required `aud` claim on the OIDC token — typically the orchestrator URL"),
			repo_pattern: z.string().optional().describe("Glob matched against the repo name (\"*\" matches all). Default: \"*\""),
			allowed_refs: z.array(z.string()).optional().describe("Allowed Git refs (e.g. [\"refs/heads/main\"]). Empty/omitted = any ref"),
			allowed_environments: z.array(z.string()).optional().describe("Allowed GitHub environments. Empty/omitted = any"),
			allowed_actions: z.array(z.string()).optional().describe("Scope strings granted to session tokens. Default: [\"artifacts:upload\",\"runs:start\"]"),
			session_ttl_seconds: z.number().int().positive().optional().describe("Session token TTL. Default: 900 (15 min)"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.oidc_trust.create(input)),
	},

	devpad_pipelines_oidc_trust_update: {
		name: "devpad_pipelines_oidc_trust_update",
		description: "Partially update a GitHub Actions OIDC trust policy. Only the supplied fields are touched; validation runs server-side against the merged record.",
		inputSchema: z.object({
			id: z.string().describe("Trust policy ID"),
			owner_id: z.string().describe("Owner ID (must match the policy's owner)"),
			github_owner: z.string().optional(),
			expected_audience: z.string().optional(),
			repo_pattern: z.string().optional(),
			allowed_refs: z.array(z.string()).optional(),
			allowed_environments: z.array(z.string()).optional(),
			allowed_actions: z.array(z.string()).optional(),
			session_ttl_seconds: z.number().int().positive().optional(),
		}),
		execute: async (client, input) => {
			const { id, ...patch } = input;
			return unwrap(await client.pipelines.oidc_trust.update(id, patch));
		},
	},

	devpad_pipelines_oidc_trust_delete: {
		name: "devpad_pipelines_oidc_trust_delete",
		description: "Soft-delete a GitHub Actions OIDC trust policy. The row is preserved for audit; the matcher and list operations skip soft-deleted rows.",
		inputSchema: z.object({
			id: z.string().describe("Trust policy ID"),
			owner_id: z.string().describe("Owner ID (must match the policy's owner)"),
		}),
		execute: async (client, input) => unwrap(await client.pipelines.oidc_trust.delete(input.id, { owner_id: input.owner_id })),
	},
};

// Get all tool names
export const toolNames = Object.keys(tools);

// Get tool by name
export function getTool(name: string): ToolDefinition | undefined {
	return tools[name];
}
