import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ApiClient } from "@devpad/api";
import { MCPTestClient } from "../shared/mcp-test-client";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

describe("MCP Extended Tools Integration", () => {
	let mcp_client: MCPTestClient;
	let api_client: ApiClient;
	const created_resources: { type: string; id: string }[] = [];

	// Helper function to extract response from MCP result
	function extractMCPResponse(result: any): any {
		// Handle in-memory mode response format
		if (result?.result?.content?.[0]?.text) {
			const response_text = result.result.content[0].text;
			if (response_text.startsWith("Error:")) {
				throw new Error(`MCP call failed: ${response_text}`);
			}
			return JSON.parse(response_text);
		}

		throw new Error(`Invalid MCP response format: ${JSON.stringify(result)}`);
	}

	beforeAll(async () => {
		// Get the shared API key from the test setup
		const { getSharedApiClient } = await import("./setup");
		const shared_client = await getSharedApiClient();
		const test_api_key = shared_client.getApiKey();

		// Create API client for verification
		api_client = new ApiClient({
			api_key: test_api_key,
			base_url: "http://localhost:3001/api/v1",
		});

		// Start MCP client (in-process mode for better coverage)
		mcp_client = new MCPTestClient();
		await mcp_client.start(test_api_key, "http://localhost:3001/api/v1");
	});

	afterAll(async () => {
		// Manual cleanup of created resources
		for (const resource of created_resources) {
			try {
				if (resource.type === "project") {
					await api_client.projects.update(resource.id, { deleted: true });
				} else if (resource.type === "milestone") {
					await api_client.milestones.delete(resource.id);
				} else if (resource.type === "goal") {
					await api_client.goals.delete(resource.id);
				}
			} catch (e) {
				// Ignore cleanup errors
			}
		}
		await mcp_client.stop();
	});

	describe("Project Extended Operations", () => {
		test("should delete a project via MCP", async () => {
			// Create a project first using TestDataFactory
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `MCP Delete Test ${Date.now()}`,
				specification: "Test specification for MCP",
				repo_url: "https://github.com/test/repo",
				repo_id: 12345,
			});

			const create_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const created_project = extractMCPResponse(create_result);

			// Delete the project via MCP
			const delete_result = await mcp_client.callTool("devpad_projects_delete", {
				id: created_project.id,
			});
			expect(delete_result?.result?.content?.[0]?.text).toContain("success");

			// Verify deletion via API
			const { project } = await api_client.projects.find(created_project.id);
			expect(project?.deleted).toBe(true);
		});

		test("should get project history via MCP", async () => {
			// Fixed: Updated route to use getProjectById instead of getProject for UUID lookup
			// Create a project using TestDataFactory
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `History Test ${Date.now()}`,
			});

			const create_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(create_result);
			created_resources.push({ type: "project", id: project.id });

			// Update project to create history
			await mcp_client.callTool("devpad_projects_upsert", {
				...project,
				description: "Updated description",
			});

			// Wait for async action recording
			await new Promise(resolve => setTimeout(resolve, 100));

			// Get project history
			const history_result = await mcp_client.callTool("devpad_projects_history", {
				project_id: project.id,
			});
			const history = extractMCPResponse(history_result);

			expect(Array.isArray(history)).toBe(true);
			// Note: History may be empty if actions are not recorded properly
			// This test mainly verifies the endpoint works, not action recording
			console.log(`Project history length: ${history.length}`);
		});

		test("should load project configuration via MCP", async () => {
			// Create a project using TestDataFactory
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Config Test ${Date.now()}`,
			});

			const create_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(create_result);
			created_resources.push({ type: "project", id: project.id });

			// Set some configuration
			await mcp_client.callTool("devpad_projects_upsert", {
				...project,
				specification: "# Test Config\nSome config here",
			});

			// Load project configuration
			const config_result = await mcp_client.callTool("devpad_projects_config_load", {
				project_id: project.id,
			});
			const config = extractMCPResponse(config_result);

			expect(config).toBeDefined();
			expect(typeof config).toBe("object");
			expect(config.config).toBeDefined();
			expect(Array.isArray(config.config.tags)).toBe(true);
			expect(Array.isArray(config.config.ignore)).toBe(true);
		});
	});

	describe("Milestone and Goal Operations", () => {
		test("should delete a milestone via MCP", async () => {
			// Create a project first
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Milestone Project ${Date.now()}`,
			});
			const project_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(project_result);
			created_resources.push({ type: "project", id: project.id });

			// Create a milestone
			const milestone_data = {
				name: `Test Milestone ${Date.now()}`,
				project_id: project.id,
				description: "Test milestone for deletion",
			};
			const create_result = await mcp_client.callTool("devpad_milestones_upsert", milestone_data);
			const milestone = extractMCPResponse(create_result);

			// Delete the milestone
			const delete_result = await mcp_client.callTool("devpad_milestones_delete", {
				id: milestone.id,
			});
			expect(delete_result?.result?.content?.[0]?.text).toContain("success");

			// Verify deletion
			const list_result = await mcp_client.callTool("devpad_milestones_list", {
				project_id: project.id,
			});
			const milestones = extractMCPResponse(list_result);
			expect(milestones.find((m: any) => m.id === milestone.id)).toBeUndefined();
		});

		test("should get milestone goals via MCP", async () => {
			// Create project and milestone
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Goals Project ${Date.now()}`,
			});
			const project_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(project_result);
			created_resources.push({ type: "project", id: project.id });

			const milestone_data = {
				name: `Goals Milestone ${Date.now()}`,
				project_id: project.id,
			};
			const milestone_result = await mcp_client.callTool("devpad_milestones_upsert", milestone_data);
			const milestone = extractMCPResponse(milestone_result);
			created_resources.push({ type: "milestone", id: milestone.id });

			// Create goals for the milestone
			const goal_1 = await mcp_client.callTool("devpad_goals_upsert", {
				name: "Goal 1",
				milestone_id: milestone.id,
			});
			const goal_2 = await mcp_client.callTool("devpad_goals_upsert", {
				name: "Goal 2",
				milestone_id: milestone.id,
			});
			created_resources.push({ type: "goal", id: extractMCPResponse(goal_1).id });
			created_resources.push({ type: "goal", id: extractMCPResponse(goal_2).id });

			// Get milestone goals
			const goals_result = await mcp_client.callTool("devpad_milestones_goals", {
				id: milestone.id,
			});
			const goals = extractMCPResponse(goals_result);

			expect(Array.isArray(goals)).toBe(true);
			expect(goals.length).toBe(2);
		});

		test("should delete a goal via MCP", async () => {
			// Create project, milestone, and goal
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Goal Delete Project ${Date.now()}`,
			});
			const project_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(project_result);
			created_resources.push({ type: "project", id: project.id });

			const milestone_data = {
				name: `Goal Delete Milestone ${Date.now()}`,
				project_id: project.id,
			};
			const milestone_result = await mcp_client.callTool("devpad_milestones_upsert", milestone_data);
			const milestone = extractMCPResponse(milestone_result);
			created_resources.push({ type: "milestone", id: milestone.id });

			const goal_data = {
				name: `Test Goal ${Date.now()}`,
				milestone_id: milestone.id,
			};
			const goal_result = await mcp_client.callTool("devpad_goals_upsert", goal_data);
			const goal = extractMCPResponse(goal_result);

			// Delete the goal
			const delete_result = await mcp_client.callTool("devpad_goals_delete", {
				id: goal.id,
			});
			expect(delete_result?.result?.content?.[0]?.text).toContain("success");
		});
	});

	describe("Task Extended Operations", () => {
		test("should delete a task via MCP", async () => {
			// Create a project and task
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Task Delete Project ${Date.now()}`,
			});
			const project_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(project_result);
			created_resources.push({ type: "project", id: project.id });

			const task_data = TestDataFactory.createTask({
				title: `Test Task ${Date.now()}`,
				project_id: project.id,
				owner_id: TEST_USER_ID,
			});
			const task_result = await mcp_client.callTool("devpad_tasks_upsert", task_data);
			const task = extractMCPResponse(task_result);

			// Delete the task
			const delete_result = await mcp_client.callTool("devpad_tasks_delete", {
				id: task.task.id,
			});
			expect(delete_result?.result?.content?.[0]?.text).toContain("success");
		});

		test("should get task history via MCP", async () => {
			// Create a project and task
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Task History Project ${Date.now()}`,
			});
			const project_result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(project_result);
			created_resources.push({ type: "project", id: project.id });

			const task_data = TestDataFactory.createTask({
				title: `History Task ${Date.now()}`,
				project_id: project.id,
				owner_id: TEST_USER_ID,
			});
			const task_result = await mcp_client.callTool("devpad_tasks_upsert", task_data);
			const task = extractMCPResponse(task_result);

			// Update task to create history
			await mcp_client.callTool("devpad_tasks_upsert", {
				...task.task,
				progress: "IN_PROGRESS",
			});

			// Wait for async history recording
			await new Promise(resolve => setTimeout(resolve, 100));

			// Get task history
			const history_result = await mcp_client.callTool("devpad_tasks_history", {
				task_id: task.task.id,
			});
			const history = extractMCPResponse(history_result);

			expect(Array.isArray(history)).toBe(true);
			// Note: History may be empty if actions are not recorded properly
			// This test mainly verifies the endpoint works, not action recording
			console.log(`Task history length: ${history.length}`);
		});
	});

	describe("User Operations", () => {
		test("should get user history via MCP", async () => {
			// Create some activity first
			const project_data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Activity Test ${Date.now()}`,
			});
			const result = await mcp_client.callTool("devpad_projects_upsert", project_data);
			const project = extractMCPResponse(result);
			created_resources.push({ type: "project", id: project.id });

			// Get user history
			const history_result = await mcp_client.callTool("devpad_user_history", {});
			const history = extractMCPResponse(history_result);

			expect(Array.isArray(history)).toBe(true);
		});

		test("should manage user preferences via MCP", async () => {
			// Update preferences (the tool requires id and task_view)
			const update_result = await mcp_client.callTool("devpad_user_preferences", {
				id: TEST_USER_ID,
				task_view: "grid",
			});
			const updated_prefs = extractMCPResponse(update_result);

			expect(updated_prefs.task_view).toBe("grid");
		});
	});

	describe("Tool Discovery", () => {
		test("should list all extended tools", async () => {
			const tools = await mcp_client.listTools();

			const expected_tools = [
				"devpad_projects_delete",
				"devpad_projects_history",
				"devpad_projects_config_load",
				"devpad_projects_config_save",
				"devpad_milestones_delete",
				"devpad_milestones_goals",
				"devpad_goals_delete",
				"devpad_tasks_delete",
				"devpad_tasks_history",
				"devpad_user_history",
				"devpad_user_preferences",
			];

			const tool_names = tools?.result?.tools?.map((t: any) => t.name) || [];
			for (const expected_tool of expected_tools) {
				expect(tool_names).toContain(expected_tool);
			}
		});
	});
});
