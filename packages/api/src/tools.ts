import { z } from "zod";
import { ApiClient } from "./api-client";
import { upsert_project, upsert_todo, upsert_milestone, upsert_goal, save_config_request, save_tags_request } from "@devpad/schema";

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
		execute: async (client, input) => {
			const result = await client.projects.list(input);
			if (result.error) throw new Error(result.error.message);
			return result.projects;
		},
	},

	devpad_projects_get: {
		name: "devpad_projects_get",
		description: "Get project by ID or name",
		inputSchema: project_by_id_or_name,
		execute: async (client, input) => {
			const result = input.id ? await client.projects.getById(input.id) : await client.projects.getByName(input.name!);
			if (result.error) throw new Error(result.error.message);
			return result.project;
		},
	},

	devpad_projects_upsert: {
		name: "devpad_projects_upsert",
		description: "Create or update a project (set deleted=true to delete)",
		inputSchema: upsert_project,
		execute: async (client, input) => {
			const result = await client.projects.upsert(input);
			if (result.error) throw new Error(result.error.message);
			return result.project;
		},
	},

	devpad_projects_config_save: {
		name: "devpad_projects_config_save",
		description: "Save project configuration",
		inputSchema: save_config_request,
		execute: async (client, input) => {
			const result = await client.projects.config.save(input);
			if (result.error) throw new Error(result.error.message);
			return { success: true };
		},
	},

	// Tasks
	devpad_tasks_list: {
		name: "devpad_tasks_list",
		description: "List tasks, optionally filtered by project or tag",
		inputSchema: task_filters,
		execute: async (client, input) => {
			const result = await client.tasks.list(input);
			if (result.error) throw new Error(result.error.message);
			return result.tasks;
		},
	},

	devpad_tasks_get: {
		name: "devpad_tasks_get",
		description: "Get task by ID",
		inputSchema: task_by_id,
		execute: async (client, input) => {
			const result = await client.tasks.find(input.id);
			if (result.error) throw new Error(result.error.message);
			return result.task;
		},
	},

	devpad_tasks_upsert: {
		name: "devpad_tasks_upsert",
		description: "Create or update a task (set deleted=true to delete)",
		inputSchema: upsert_todo,
		execute: async (client, input) => {
			const result = await client.tasks.upsert(input);
			if (result.error) throw new Error(result.error.message);
			return result.task;
		},
	},

	devpad_tasks_save_tags: {
		name: "devpad_tasks_save_tags",
		description: "Save tags for tasks",
		inputSchema: save_tags_request,
		execute: async (client, input) => {
			const result = await client.tasks.saveTags(input);
			if (result.error) throw new Error(result.error.message);
			return { success: true };
		},
	},

	// Milestones
	devpad_milestones_list: {
		name: "devpad_milestones_list",
		description: "List milestones for authenticated user or by project",
		inputSchema: milestone_filters,
		execute: async (client, input) => {
			const result = input.project_id ? await client.milestones.getByProject(input.project_id) : await client.milestones.list();
			if (result.error) throw new Error(result.error.message);
			return result.milestones;
		},
	},

	devpad_milestones_get: {
		name: "devpad_milestones_get",
		description: "Get milestone by ID",
		inputSchema: milestone_by_id,
		execute: async (client, input) => {
			const result = await client.milestones.find(input.id);
			if (result.error) throw new Error(result.error.message);
			return result.milestone;
		},
	},

	devpad_milestones_upsert: {
		name: "devpad_milestones_upsert",
		description: "Create or update a milestone",
		inputSchema: upsert_milestone,
		execute: async (client, input) => {
			const result = input.id
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
					});
			if (result.error) throw new Error(result.error.message);
			return result.milestone;
		},
	},

	// Goals
	devpad_goals_list: {
		name: "devpad_goals_list",
		description: "List goals for authenticated user",
		inputSchema: z.object({}),
		execute: async client => {
			const result = await client.goals.list();
			if (result.error) throw new Error(result.error.message);
			return result.goals;
		},
	},

	devpad_goals_get: {
		name: "devpad_goals_get",
		description: "Get goal by ID",
		inputSchema: goal_by_id,
		execute: async (client, input) => {
			const result = await client.goals.find(input.id);
			if (result.error) throw new Error(result.error.message);
			return result.goal;
		},
	},

	devpad_goals_upsert: {
		name: "devpad_goals_upsert",
		description: "Create or update a goal",
		inputSchema: upsert_goal,
		execute: async (client, input) => {
			const result = input.id
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
					});
			if (result.error) throw new Error(result.error.message);
			return result.goal;
		},
	},

	// Tags
	devpad_tags_list: {
		name: "devpad_tags_list",
		description: "List tags for authenticated user",
		inputSchema: z.object({}),
		execute: async client => {
			const result = await client.tags.list();
			if (result.error) throw new Error(result.error.message);
			return result.tags;
		},
	},

	// GitHub integration
	devpad_github_repos: {
		name: "devpad_github_repos",
		description: "List GitHub repositories for authenticated user",
		inputSchema: z.object({}),
		execute: async client => {
			const result = await client.github.repos();
			if (result.error) throw new Error(result.error.message);
			return result.repos;
		},
	},

	devpad_github_branches: {
		name: "devpad_github_branches",
		description: "List branches for a GitHub repository",
		inputSchema: github_branches,
		execute: async (client, input) => {
			const result = await client.github.branches(input.owner, input.repo);
			if (result.error) throw new Error(result.error.message);
			return result.branches;
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
