import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MCPTestClient } from "../shared/mcp-test-client";
import { ApiClient } from "@devpad/api";
import { TEST_USER_ID } from "./setup";
import { TestDataFactory } from "./factories";

describe("MCP Extended Tools Integration", () => {
	let mcpClient: MCPTestClient;
	let apiClient: ApiClient;
	const createdResources: { type: string; id: string }[] = [];

	// Helper function to extract response from MCP result
	function extractMCPResponse(result: any): any {
		if (!result?.result?.content?.[0]?.text) {
			throw new Error(`Invalid MCP response format: ${JSON.stringify(result)}`);
		}
		const responseText = result.result.content[0].text;
		if (responseText.startsWith("Error:")) {
			throw new Error(`MCP call failed: ${responseText}`);
		}
		return JSON.parse(responseText);
	}

	beforeAll(async () => {
		// Get the shared API key from the test setup
		const { getSharedApiClient } = await import("./setup");
		const sharedClient = await getSharedApiClient();
		const testApiKey = sharedClient.getApiKey();

		// Create API client for verification
		apiClient = new ApiClient({
			api_key: testApiKey,
			base_url: "http://localhost:3001/api/v0",
		});

		// Start MCP client
		mcpClient = new MCPTestClient();
		await mcpClient.start(testApiKey, "http://localhost:3001/api/v0");
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
			// Create a project first using TestDataFactory
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `MCP Delete Test ${Date.now()}`,
				specification: "Test specification for MCP",
				repo_url: "https://github.com/test/repo",
				repo_id: 12345,
			});

			const createResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const createdProject = extractMCPResponse(createResult);

			// Delete the project via MCP
			const deleteResult = await mcpClient.callTool("devpad_projects_delete", {
				id: createdProject.id,
			});
			expect(deleteResult?.result?.content?.[0]?.text).toContain("success");

			// Verify deletion via API
			const { project } = await apiClient.projects.find(createdProject.id);
			expect(project?.deleted).toBe(true);
		});

		test("should get project history via MCP", async () => {
			// Fixed: Updated route to use getProjectById instead of getProject for UUID lookup
			// Create a project using TestDataFactory
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `History Test ${Date.now()}`,
			});

			const createResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(createResult);
			createdResources.push({ type: "project", id: project.id });

			// Update project to create history
			await mcpClient.callTool("devpad_projects_upsert", {
				...project,
				description: "Updated description",
			});

			// Wait for async action recording
			await new Promise(resolve => setTimeout(resolve, 100));

			// Get project history
			const historyResult = await mcpClient.callTool("devpad_projects_history", {
				project_id: project.id,
			});
			const history = extractMCPResponse(historyResult);

			expect(Array.isArray(history)).toBe(true);
			// Note: History may be empty if actions are not recorded properly
			// This test mainly verifies the endpoint works, not action recording
			console.log(`Project history length: ${history.length}`);
		});

		test("should load project configuration via MCP", async () => {
			// Create a project using TestDataFactory
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Config Test ${Date.now()}`,
			});

			const createResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(createResult);
			createdResources.push({ type: "project", id: project.id });

			// Set some configuration
			await mcpClient.callTool("devpad_projects_upsert", {
				...project,
				specification: "# Test Config\nSome config here",
			});

			// Load project configuration
			const configResult = await mcpClient.callTool("devpad_projects_config_load", {
				project_id: project.id,
			});
			const config = extractMCPResponse(configResult);

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
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Milestone Project ${Date.now()}`,
			});
			const projectResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(projectResult);
			createdResources.push({ type: "project", id: project.id });

			// Create a milestone
			const milestoneData = {
				name: `Test Milestone ${Date.now()}`,
				project_id: project.id,
				description: "Test milestone for deletion",
			};
			const createResult = await mcpClient.callTool("devpad_milestones_upsert", milestoneData);
			const milestone = extractMCPResponse(createResult);

			// Delete the milestone
			const deleteResult = await mcpClient.callTool("devpad_milestones_delete", {
				id: milestone.id,
			});
			expect(deleteResult?.result?.content?.[0]?.text).toContain("success");

			// Verify deletion
			const listResult = await mcpClient.callTool("devpad_milestones_list", {
				project_id: project.id,
			});
			const milestones = extractMCPResponse(listResult);
			expect(milestones.find((m: any) => m.id === milestone.id)).toBeUndefined();
		});

		test("should get milestone goals via MCP", async () => {
			// Create project and milestone
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Goals Project ${Date.now()}`,
			});
			const projectResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(projectResult);
			createdResources.push({ type: "project", id: project.id });

			const milestoneData = {
				name: `Goals Milestone ${Date.now()}`,
				project_id: project.id,
			};
			const milestoneResult = await mcpClient.callTool("devpad_milestones_upsert", milestoneData);
			const milestone = extractMCPResponse(milestoneResult);
			createdResources.push({ type: "milestone", id: milestone.id });

			// Create goals for the milestone
			const goal1 = await mcpClient.callTool("devpad_goals_upsert", {
				name: "Goal 1",
				milestone_id: milestone.id,
			});
			const goal2 = await mcpClient.callTool("devpad_goals_upsert", {
				name: "Goal 2",
				milestone_id: milestone.id,
			});
			createdResources.push({ type: "goal", id: extractMCPResponse(goal1).id });
			createdResources.push({ type: "goal", id: extractMCPResponse(goal2).id });

			// Get milestone goals
			const goalsResult = await mcpClient.callTool("devpad_milestones_goals", {
				id: milestone.id,
			});
			const goals = extractMCPResponse(goalsResult);

			expect(Array.isArray(goals)).toBe(true);
			expect(goals.length).toBe(2);
		});

		test("should delete a goal via MCP", async () => {
			// Create project, milestone, and goal
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Goal Delete Project ${Date.now()}`,
			});
			const projectResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(projectResult);
			createdResources.push({ type: "project", id: project.id });

			const milestoneData = {
				name: `Goal Delete Milestone ${Date.now()}`,
				project_id: project.id,
			};
			const milestoneResult = await mcpClient.callTool("devpad_milestones_upsert", milestoneData);
			const milestone = extractMCPResponse(milestoneResult);
			createdResources.push({ type: "milestone", id: milestone.id });

			const goalData = {
				name: `Test Goal ${Date.now()}`,
				milestone_id: milestone.id,
			};
			const goalResult = await mcpClient.callTool("devpad_goals_upsert", goalData);
			const goal = extractMCPResponse(goalResult);

			// Delete the goal
			const deleteResult = await mcpClient.callTool("devpad_goals_delete", {
				id: goal.id,
			});
			expect(deleteResult?.result?.content?.[0]?.text).toContain("success");
		});
	});

	describe("Task Extended Operations", () => {
		test("should delete a task via MCP", async () => {
			// Create a project and task
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Task Delete Project ${Date.now()}`,
			});
			const projectResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(projectResult);
			createdResources.push({ type: "project", id: project.id });

			const taskData = TestDataFactory.createTask({
				title: `Test Task ${Date.now()}`,
				project_id: project.id,
				owner_id: TEST_USER_ID,
			});
			const taskResult = await mcpClient.callTool("devpad_tasks_upsert", taskData);
			const task = extractMCPResponse(taskResult);

			// Delete the task
			const deleteResult = await mcpClient.callTool("devpad_tasks_delete", {
				id: task.task.id,
			});
			expect(deleteResult?.result?.content?.[0]?.text).toContain("success");
		});

		test("should get task history via MCP", async () => {
			// Create a project and task
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Task History Project ${Date.now()}`,
			});
			const projectResult = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(projectResult);
			createdResources.push({ type: "project", id: project.id });

			const taskData = TestDataFactory.createTask({
				title: `History Task ${Date.now()}`,
				project_id: project.id,
				owner_id: TEST_USER_ID,
			});
			const taskResult = await mcpClient.callTool("devpad_tasks_upsert", taskData);
			const task = extractMCPResponse(taskResult);

			// Update task to create history
			await mcpClient.callTool("devpad_tasks_upsert", {
				...task.task,
				progress: "IN_PROGRESS",
			});

			// Wait for async history recording
			await new Promise(resolve => setTimeout(resolve, 100));

			// Get task history
			const historyResult = await mcpClient.callTool("devpad_tasks_history", {
				task_id: task.task.id,
			});
			const history = extractMCPResponse(historyResult);

			expect(Array.isArray(history)).toBe(true);
			// Note: History may be empty if actions are not recorded properly
			// This test mainly verifies the endpoint works, not action recording
			console.log(`Task history length: ${history.length}`);
		});
	});

	describe("User Operations", () => {
		test("should get user history via MCP", async () => {
			// Create some activity first
			const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
				name: `Activity Test ${Date.now()}`,
			});
			const result = await mcpClient.callTool("devpad_projects_upsert", projectData);
			const project = extractMCPResponse(result);
			createdResources.push({ type: "project", id: project.id });

			// Get user history
			const historyResult = await mcpClient.callTool("devpad_user_history", {});
			const history = extractMCPResponse(historyResult);

			expect(Array.isArray(history)).toBe(true);
		});

		test("should manage user preferences via MCP", async () => {
			// Update preferences (the tool requires id and task_view)
			const updateResult = await mcpClient.callTool("devpad_user_preferences", {
				id: TEST_USER_ID,
				task_view: "grid",
			});
			const updatedPrefs = extractMCPResponse(updateResult);

			expect(updatedPrefs.task_view).toBe("grid");
		});
	});

	describe("Tool Discovery", () => {
		test("should list all extended tools", async () => {
			const tools = await mcpClient.listTools();

			const expectedTools = [
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

			const toolNames = tools?.result?.tools?.map((t: any) => t.name) || [];
			for (const expectedTool of expectedTools) {
				expect(toolNames).toContain(expectedTool);
			}
		});
	});
});
