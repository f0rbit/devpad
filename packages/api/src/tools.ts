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
						})
					: await client.milestones.create({
							project_id: input.project_id,
							name: input.name,
							description: input.description,
							target_time: input.target_time,
							target_version: input.target_version,
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
						})
					: await client.goals.create({
							milestone_id: input.milestone_id,
							name: input.name,
							description: input.description,
							target_time: input.target_time,
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
};

// Helper to convert Zod schema to JSON Schema for MCP
export function zodToMCPSchema(schema: z.ZodType<any>) {
	// This will be imported from zod-to-json-schema for MCP server
	// For now, returning a placeholder
	return schema;
}

// Get all tool names
export const toolNames = Object.keys(tools);

// Get tool by name
export function getTool(name: string): ToolDefinition | undefined {
	return tools[name];
}
