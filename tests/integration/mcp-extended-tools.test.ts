import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MCPTestClient } from "../shared/mcp-test-client";
import { ApiClient } from "@devpad/api";
import { TEST_USER_ID } from "./setup";

describe("MCP Extended Tools Integration", () => {
	let mcpClient: MCPTestClient;
	let apiClient: ApiClient;
	const createdResources: { type: string; id: string }[] = [];

	beforeAll(async () => {
		const testApiKey = process.env.TEST_API_KEY || "test-key-12345";

		// Create API client for verification
		apiClient = new ApiClient({
			api_key: testApiKey,
			base_url: "http://localhost:3000/api/v0",
		});

		// Start MCP client
		mcpClient = new MCPTestClient();
		await mcpClient.start(testApiKey);
	});

	afterAll(async () => {
		// Manual cleanup of created resources
		for (const resource of createdResources) {
			try {
				if (resource.type === "project") {
					await apiClient.projects.update(resource.id, { deleted: true });
				} else if (resource.type === "milestone") {
					await apiClient.milestones.delete(resource.id);
				} else if (resource.type === "goal") {
					await apiClient.goals.delete(resource.id);
				}
			} catch (e) {
				// Ignore cleanup errors
			}
		}
		await mcpClient.stop();
	});

	describe("Project Extended Operations", () => {
		test("should delete a project via MCP", async () => {
			// Create a project first
			const projectData = {
				name: `Test Project ${Date.now()}`,
				project_id: `test-${Date.now()}`,
				description: "Test project for MCP deletion",
				owner_id: TEST_USER_ID,
				visibility: "PRIVATE",
				status: "DEVELOPMENT",
			};

			const createResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			expect(createResult.content[0].text).toBeDefined();
			const createdProject = JSON.parse(createResult.content[0].text);

			// Delete the project via MCP
			const deleteResult = await mcpClient.callTool("devpad_projects_delete", {
				id: createdProject.id,
			});
			expect(deleteResult.content[0].text).toContain("success");

			// Verify deletion via API
			const { project } = await apiClient.projects.find(createdProject.id);
			expect(project?.deleted).toBe(true);
		});

		test("should get project history via MCP", async () => {
			// Create a project
			const projectData = {
				name: `History Test ${Date.now()}`,
				project_id: `hist-${Date.now()}`,
				owner_id: TEST_USER_ID,
			};

			const createResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = JSON.parse(createResult.content[0].text);
			createdResources.push({ type: "project", id: project.id });

			// Update project to generate history
			await mcpClient.callTool("devpad_projects_upsert", {
				id: project.id,
				name: project.name + " Updated",
			});

			// Get history via MCP
			const historyResult = await mcpClient.callTool("devpad_projects_history", {
				project_id: project.id,
			});
			const history = JSON.parse(historyResult.content[0].text);
			expect(Array.isArray(history)).toBe(true);
		});

		test("should load project configuration via MCP", async () => {
			// Create a project
			const projectData = {
				name: `Config Test ${Date.now()}`,
				project_id: `config-${Date.now()}`,
				owner_id: TEST_USER_ID,
			};

			const createResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = JSON.parse(createResult.content[0].text);
			createdResources.push({ type: "project", id: project.id });

			// Save config
			const config = {
				project_id: project.project_id,
				tasks_tag_id: null,
				tasks_folder: "/tasks",
			};
			await mcpClient.callTool("devpad_projects_config_save", config);

			// Load config via MCP
			const loadResult = await mcpClient.callTool("devpad_projects_config_load", {
				project_id: project.project_id,
			});
			const loadedConfig = JSON.parse(loadResult.content[0].text);
			expect(loadedConfig).toBeDefined();
			if (loadedConfig) {
				expect(loadedConfig.tasks_folder).toBe("/tasks");
			}
		});
	});

	describe("Milestone and Goal Operations", () => {
		let testProjectId: string;

		beforeAll(async () => {
			// Create a project for milestones/goals
			const projectData = {
				name: `Milestone Test ${Date.now()}`,
				project_id: `mile-${Date.now()}`,
				owner_id: TEST_USER_ID,
			};
			const result = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = JSON.parse(result.content[0].text);
			testProjectId = project.id;
			createdResources.push({ type: "project", id: testProjectId });
		});

		test("should delete a milestone via MCP", async () => {
			// Create a milestone
			const milestoneData = {
				project_id: testProjectId,
				name: "Test Milestone",
				description: "To be deleted",
			};
			const createResult = await mcpClient.callTool("devpad_milestones_upsert", milestoneData);
			const milestone = JSON.parse(createResult.content[0].text);

			// Delete the milestone via MCP
			const deleteResult = await mcpClient.callTool("devpad_milestones_delete", {
				id: milestone.id,
			});
			const result = JSON.parse(deleteResult.content[0].text);
			expect(result.success).toBe(true);
		});

		test("should get milestone goals via MCP", async () => {
			// Create milestone
			const milestoneData = {
				project_id: testProjectId,
				name: "Milestone with Goals",
			};
			const milestoneResult = await mcpClient.callTool("devpad_milestones_upsert", milestoneData);
			const milestone = JSON.parse(milestoneResult.content[0].text);
			createdResources.push({ type: "milestone", id: milestone.id });

			// Create a goal for the milestone
			const goalData = {
				milestone_id: milestone.id,
				name: "Test Goal",
			};
			const goalResult = await mcpClient.callTool("devpad_goals_upsert", goalData);
			const goal = JSON.parse(goalResult.content[0].text);
			createdResources.push({ type: "goal", id: goal.id });

			// Get milestone goals via MCP
			const goalsResult = await mcpClient.callTool("devpad_milestones_goals", {
				id: milestone.id,
			});
			const goals = JSON.parse(goalsResult.content[0].text);
			expect(Array.isArray(goals)).toBe(true);
			expect(goals.length).toBeGreaterThan(0);
		});

		test("should delete a goal via MCP", async () => {
			// Create milestone first
			const milestoneData = {
				project_id: testProjectId,
				name: "Milestone for Goal Delete",
			};
			const milestoneResult = await mcpClient.callTool("devpad_milestones_upsert", milestoneData);
			const milestone = JSON.parse(milestoneResult.content[0].text);
			createdResources.push({ type: "milestone", id: milestone.id });

			// Create a goal
			const goalData = {
				milestone_id: milestone.id,
				name: "Goal to Delete",
			};
			const createResult = await mcpClient.callTool("devpad_goals_upsert", goalData);
			const goal = JSON.parse(createResult.content[0].text);

			// Delete the goal via MCP
			const deleteResult = await mcpClient.callTool("devpad_goals_delete", {
				id: goal.id,
			});
			const result = JSON.parse(deleteResult.content[0].text);
			expect(result.success).toBe(true);
		});
	});

	describe("Task Extended Operations", () => {
		let testProjectId: string;

		beforeAll(async () => {
			// Create project for tasks
			const projectData = {
				name: `Task Test ${Date.now()}`,
				project_id: `task-${Date.now()}`,
				owner_id: TEST_USER_ID,
			};
			const result = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = JSON.parse(result.content[0].text);
			testProjectId = project.project_id;
			createdResources.push({ type: "project", id: project.id });
		});

		test("should delete a task via MCP", async () => {
			// Create a task
			const taskData = {
				title: "Task to Delete",
				project_id: testProjectId,
				owner_id: TEST_USER_ID,
				progress: "TODO",
			};
			const createResult = await mcpClient.callTool("devpad_tasks_upsert", taskData);
			const task = JSON.parse(createResult.content[0].text);

			// Delete the task via MCP
			const deleteResult = await mcpClient.callTool("devpad_tasks_delete", {
				id: task.task.id,
			});
			const result = JSON.parse(deleteResult.content[0].text);
			expect(result.success).toBe(true);
		});

		test("should get task history via MCP", async () => {
			// Create a task
			const taskData = {
				title: "Task with History",
				project_id: testProjectId,
				owner_id: TEST_USER_ID,
				progress: "TODO",
			};
			const createResult = await mcpClient.callTool("devpad_tasks_upsert", taskData);
			const task = JSON.parse(createResult.content[0].text);

			// Update task to generate history
			await mcpClient.callTool("devpad_tasks_upsert", {
				id: task.task.id,
				progress: "IN_PROGRESS",
			});

			// Get history via MCP
			const historyResult = await mcpClient.callTool("devpad_tasks_history", {
				task_id: task.task.id,
			});
			const history = JSON.parse(historyResult.content[0].text);
			expect(Array.isArray(history)).toBe(true);
		});
	});

	describe("Authentication Operations", () => {
		test("should get session info via MCP", async () => {
			const sessionResult = await mcpClient.callTool("devpad_auth_session", {});
			const session = JSON.parse(sessionResult.content[0].text);
			expect(session).toBeDefined();
			expect(session.authenticated).toBeDefined();
		});

		test("should list API keys via MCP", async () => {
			const keysResult = await mcpClient.callTool("devpad_auth_keys_list", {});
			const keys = JSON.parse(keysResult.content[0].text);
			expect(keys).toBeDefined();
			expect(Array.isArray(keys.keys)).toBe(true);
		});
	});

	describe("User Operations", () => {
		test("should get user history via MCP", async () => {
			// Create some activity first
			const projectData = {
				name: `Activity Test ${Date.now()}`,
				project_id: `act-${Date.now()}`,
				owner_id: TEST_USER_ID,
			};
			const result = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = JSON.parse(result.content[0].text);
			createdResources.push({ type: "project", id: project.id });

			// Get user history via MCP
			const historyResult = await mcpClient.callTool("devpad_user_history", {});
			const history = JSON.parse(historyResult.content[0].text);
			expect(Array.isArray(history)).toBe(true);
		});
	});

	describe("Tool Discovery", () => {
		test("should list all extended tools", async () => {
			const tools = await mcpClient.listTools();

			// Check that all new tools are available
			const expectedTools = [
				"devpad_auth_session",
				"devpad_auth_keys_list",
				"devpad_auth_keys_create",
				"devpad_auth_keys_revoke",
				"devpad_projects_delete",
				"devpad_projects_history",
				"devpad_projects_config_load",
				"devpad_milestones_delete",
				"devpad_milestones_goals",
				"devpad_goals_delete",
				"devpad_tasks_delete",
				"devpad_tasks_history",
				"devpad_user_history",
				"devpad_user_preferences",
			];

			const toolNames = tools.map((t: any) => t.name);
			for (const expectedTool of expectedTools) {
				expect(toolNames).toContain(expectedTool);
			}
		});
	});
});
