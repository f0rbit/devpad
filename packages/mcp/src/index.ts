#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import ApiClient from "@devpad/api";
import { upsert_project, upsert_todo, upsert_tag, upsert_milestone, upsert_goal, save_config_request, save_tags_request } from "@devpad/schema";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// Helper to convert Zod schema to JSON Schema for MCP
function zodToMCPSchema(schema: z.ZodSchema) {
	const jsonSchema = zodToJsonSchema(schema, {
		target: "openApi3",
		$refStrategy: "none",
	}) as any;
	// Remove the $schema property that zod-to-json-schema adds
	const { $schema, ...cleanSchema } = jsonSchema;

	if (jsonSchema.type === "object") return jsonSchema;

	// Ensure every tool schema is an object
	return {
		type: "object",
		properties: {
			value: cleanSchema, // wrap non-objects under "value"
		},
		required: [],
	};
}

function assertObjectRootSchema(tools: any[]) {
	tools.forEach((tool, i) => {
		if (tool.inputSchema.type !== "object") {
			console.error(`! Tool ${i} (${tool.name}) has non-object root type: ${tool.inputSchema.type}`);
		}
	});
	return tools;
}

// Simple filter schemas that aren't in @devpad/schema yet
const project_filters = z.object({
	private: z.boolean().optional().describe("Include private projects (default: true)"),
});

const project_by_id_or_name = z
	.object({
		id: z.string().optional().describe("Project ID"),
		name: z.string().optional().describe("Project name"),
	})
	.refine(data => data.id || data.name, {
		message: "Either 'id' or 'name' must be provided",
	});

const task_filters = z.object({
	project_id: z.string().optional().describe("Filter by project ID"),
	tag_id: z.string().optional().describe("Filter by tag ID"),
});

const task_by_id = z.object({
	id: z.string().describe("Task ID"),
});

const milestone_filters = z.object({
	project_id: z.string().optional().describe("Filter by project ID"),
});

const milestone_by_id = z.object({
	id: z.string().describe("Milestone ID"),
});

const goal_by_id = z.object({
	id: z.string().describe("Goal ID"),
});

const github_branches = z.object({
	owner: z.string().describe("Repository owner"),
	repo: z.string().describe("Repository name"),
});

// For tasks that can have tags
const upsert_todo_with_tags = upsert_todo.extend({
	tags: z.array(upsert_tag).optional().describe("Tags to associate with the task"),
});

const tools = [
	// Projects
	{
		name: "devpad_projects_list",
		description: "List all projects (or only public ones)",
		inputSchema: zodToMCPSchema(project_filters),
	},
	{
		name: "devpad_projects_get",
		description: "Get project by ID or name",
		inputSchema: zodToMCPSchema(project_by_id_or_name),
	},
	{
		name: "devpad_projects_upsert",
		description: "Create or update a project (set deleted=true to delete)",
		inputSchema: zodToMCPSchema(upsert_project),
	},
	{
		name: "devpad_projects_config_save",
		description: "Save project configuration",
		inputSchema: zodToMCPSchema(save_config_request),
	},

	// Tasks
	{
		name: "devpad_tasks_list",
		description: "List tasks, optionally filtered by project or tag",
		inputSchema: zodToMCPSchema(task_filters),
	},
	{
		name: "devpad_tasks_get",
		description: "Get task by ID",
		inputSchema: zodToMCPSchema(task_by_id),
	},
	{
		name: "devpad_tasks_upsert",
		description: "Create or update a task (set deleted=true to delete)",
		inputSchema: zodToMCPSchema(upsert_todo_with_tags),
	},
	{
		name: "devpad_tasks_save_tags",
		description: "Save tags for tasks",
		inputSchema: zodToMCPSchema(save_tags_request),
	},

	// Milestones
	{
		name: "devpad_milestones_list",
		description: "List milestones for authenticated user or by project",
		inputSchema: zodToMCPSchema(milestone_filters),
	},
	{
		name: "devpad_milestones_get",
		description: "Get milestone by ID",
		inputSchema: zodToMCPSchema(milestone_by_id),
	},
	{
		name: "devpad_milestones_upsert",
		description: "Create or update a milestone",
		inputSchema: zodToMCPSchema(upsert_milestone),
	},

	// Goals
	{
		name: "devpad_goals_list",
		description: "List goals for authenticated user",
		inputSchema: zodToMCPSchema(z.object({})),
	},
	{
		name: "devpad_goals_get",
		description: "Get goal by ID",
		inputSchema: zodToMCPSchema(goal_by_id),
	},
	{
		name: "devpad_goals_upsert",
		description: "Create or update a goal",
		inputSchema: zodToMCPSchema(upsert_goal),
	},

	// Tags
	{
		name: "devpad_tags_list",
		description: "List tags for authenticated user",
		inputSchema: zodToMCPSchema(z.object({})),
	},

	// GitHub integration
	{
		name: "devpad_github_repos",
		description: "List GitHub repositories for authenticated user",
		inputSchema: zodToMCPSchema(z.object({})),
	},
	{
		name: "devpad_github_branches",
		description: "List branches for a GitHub repository",
		inputSchema: zodToMCPSchema(github_branches),
	},
];

class DevpadMCPServer {
	private server: Server;
	private apiClient: ApiClient;

	constructor() {
		this.server = new Server(
			{
				name: "devpad-mcp-server",
				version: "0.1.0",
			},
			{
				capabilities: {
					tools: {},
				},
			}
		);

		const apiKey = process.env.DEVPAD_API_KEY;
		const baseUrl = process.env.DEVPAD_BASE_URL || "https://devpad.tools/api/v0";

		if (!apiKey) {
			console.error("DEVPAD_API_KEY environment variable is required");
			process.exit(1);
		}

		this.apiClient = new ApiClient({
			api_key: apiKey,
			base_url: baseUrl,
		});

		this.setupHandlers();
	}

	private setupHandlers() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools };
		});

		this.server.setRequestHandler(CallToolRequestSchema, async request => {
			const { name, arguments: args } = request.params;

			try {
				switch (name) {
					// Projects
					case "devpad_projects_list": {
						const filters = project_filters.parse(args);
						const result = await this.apiClient.projects.list(filters);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.projects, null, 2),
								},
							],
						};
					}

					case "devpad_projects_get": {
						const params = project_by_id_or_name.parse(args);
						const result = params.id ? await this.apiClient.projects.getById(params.id) : await this.apiClient.projects.getByName(params.name!);

						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.project, null, 2),
								},
							],
						};
					}

					case "devpad_projects_upsert": {
						const data = upsert_project.parse(args);
						// Use the upsert method which handles both create and update
						const result = await this.apiClient.projects.upsert(data);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.project, null, 2),
								},
							],
						};
					}

					case "devpad_projects_config_save": {
						const data = save_config_request.parse(args);
						const result = await this.apiClient.projects.config.save(data);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: "Project configuration saved successfully",
								},
							],
						};
					}

					// Tasks
					case "devpad_tasks_list": {
						const filters = task_filters.parse(args);
						const result = await this.apiClient.tasks.list(filters);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.tasks, null, 2),
								},
							],
						};
					}

					case "devpad_tasks_get": {
						const { id } = task_by_id.parse(args);
						const result = await this.apiClient.tasks.find(id);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.task, null, 2),
								},
							],
						};
					}

					case "devpad_tasks_upsert": {
						const data = upsert_todo_with_tags.parse(args);
						// Use the upsert method which handles both create and update
						const result = await this.apiClient.tasks.upsert(data);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.task, null, 2),
								},
							],
						};
					}

					case "devpad_tasks_save_tags": {
						const data = save_tags_request.parse(args);
						const result = await this.apiClient.tasks.saveTags(data);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: "Tags saved successfully",
								},
							],
						};
					}

					// Milestones
					case "devpad_milestones_list": {
						const { project_id } = milestone_filters.parse(args);
						const result = project_id ? await this.apiClient.milestones.getByProject(project_id) : await this.apiClient.milestones.list();

						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.milestones, null, 2),
								},
							],
						};
					}

					case "devpad_milestones_get": {
						const { id } = milestone_by_id.parse(args);
						const result = await this.apiClient.milestones.find(id);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.milestone, null, 2),
								},
							],
						};
					}

					case "devpad_milestones_upsert": {
						const data = upsert_milestone.parse(args);
						// If there's an ID, it's an update; otherwise, it's a create
						const result = data.id
							? await this.apiClient.milestones.update(data.id, {
									name: data.name,
									description: data.description,
									target_time: data.target_time,
									target_version: data.target_version,
								})
							: await this.apiClient.milestones.create({
									project_id: data.project_id,
									name: data.name,
									description: data.description,
									target_time: data.target_time,
									target_version: data.target_version,
								});

						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.milestone, null, 2),
								},
							],
						};
					}

					// Goals
					case "devpad_goals_list": {
						const result = await this.apiClient.goals.list();
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.goals, null, 2),
								},
							],
						};
					}

					case "devpad_goals_get": {
						const { id } = goal_by_id.parse(args);
						const result = await this.apiClient.goals.find(id);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.goal, null, 2),
								},
							],
						};
					}

					case "devpad_goals_upsert": {
						const data = upsert_goal.parse(args);
						// If there's an ID, it's an update; otherwise, it's a create
						const result = data.id
							? await this.apiClient.goals.update(data.id, {
									name: data.name,
									description: data.description,
									target_time: data.target_time,
								})
							: await this.apiClient.goals.create({
									milestone_id: data.milestone_id,
									name: data.name,
									description: data.description,
									target_time: data.target_time,
								});

						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.goal, null, 2),
								},
							],
						};
					}

					// Tags
					case "devpad_tags_list": {
						const result = await this.apiClient.tags.list();
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.tags, null, 2),
								},
							],
						};
					}

					// GitHub integration
					case "devpad_github_repos": {
						const result = await this.apiClient.github.repos();
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.repos, null, 2),
								},
							],
						};
					}

					case "devpad_github_branches": {
						const { owner, repo } = github_branches.parse(args);
						const result = await this.apiClient.github.branches(owner, repo);
						if (result.error) {
							throw new Error(result.error.message);
						}
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(result.branches, null, 2),
								},
							],
						};
					}

					default:
						throw new Error(`Unknown tool: ${name}`);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				return {
					content: [
						{
							type: "text",
							text: `Error: ${errorMessage}`,
						},
					],
					isError: true,
				};
			}
		});
	}

	async run() {
		const transport = new StdioServerTransport();
		await this.server.connect(transport);
		console.error("devpad MCP server running on stdio");
	}
}

async function main() {
	assertObjectRootSchema(tools);
	const server = new DevpadMCPServer();
	await server.run();
}

// Check if this file is being run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
	main().catch(error => {
		console.error("Server error:", error);
		process.exit(1);
	});
}
