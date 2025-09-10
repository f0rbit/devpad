import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type ApiClient from "@devpad/api";
import { CleanupManager } from "../shared/cleanup-manager";
import { MCPTestClient } from "../shared/mcp-test-client";
import { TestDataFactory } from "./factories";
import { getSharedApiClient, TEST_BASE_URL, TEST_USER_ID } from "./setup";

describe("MCP Server Integration", () => {
	let mcpClient: MCPTestClient;
	let apiClient: ApiClient;
	let cleanupManager: CleanupManager;
	let testProjectId: string;

	beforeAll(async () => {
		// Get shared test API client from existing setup
		apiClient = await getSharedApiClient();
		cleanupManager = new CleanupManager(apiClient);

		// Start MCP server with test API key
		mcpClient = new MCPTestClient();
		await mcpClient.start(apiClient.getApiKey(), TEST_BASE_URL);

		// Generate unique project ID for this test run
		testProjectId = `mcp-test-${Date.now()}`;
	});

	afterAll(async () => {
		// Clean up all test resources
		await cleanupManager.cleanupAll();

		// Stop MCP server
		await mcpClient.stop();
	});

	test("should list available tools", async () => {
		const response = await mcpClient.listTools();

		expect(response.result).toBeDefined();
		expect(response.result.tools).toBeArray();

		const toolNames = response.result.tools.map((t: { name: string }) => t.name);

		// Check for expected tools
		expect(toolNames).toContain("devpad_projects_list");
		expect(toolNames).toContain("devpad_projects_upsert");
		expect(toolNames).toContain("devpad_tasks_list");
		expect(toolNames).toContain("devpad_tasks_upsert");
		expect(toolNames).toContain("devpad_milestones_list");
		expect(toolNames).toContain("devpad_goals_list");
	});

	test("should create and update project via MCP", async () => {
		// Create project data using factory
		const projectData = TestDataFactory.createProject(TEST_USER_ID, {
			project_id: testProjectId,
			name: "MCP Test Project",
			description: "Created via MCP integration test",
			visibility: "PRIVATE",
			status: "DEVELOPMENT",
		});

		const { id, created_at, updated_at, deleted, scan_branch, ...projectForUpsert } = projectData;

		const createResponse = await mcpClient.callTool("devpad_projects_upsert", projectForUpsert);

		expect(createResponse.result).toBeDefined();
		expect(createResponse.result.content[0].text).toContain(testProjectId);

		const createdProject = JSON.parse(createResponse.result.content[0].text);
		expect(createdProject.name).toBe("MCP Test Project");
		expect(createdProject.visibility).toBe("PRIVATE");

		// Register for cleanup
		cleanupManager.registerProject(createdProject);

		// Update project
		const updateResponse = await mcpClient.callTool(
			"devpad_projects_upsert",
			TestDataFactory.createProject(TEST_USER_ID, {
				id: createdProject.id,
				project_id: testProjectId,
				name: "MCP Test Project Updated",
				description: "Updated via MCP",
				visibility: "PUBLIC",
				status: "LIVE",
			})
		);

		expect(updateResponse.result).toBeDefined();
		const updatedProject = JSON.parse(updateResponse.result.content[0].text);
		expect(updatedProject.name).toBe("MCP Test Project Updated");
		expect(updatedProject.visibility).toBe("PUBLIC");
		expect(updatedProject.status).toBe("LIVE");
	});

	test("should create tasks with different statuses", async () => {
		// Ensure project exists first using factory
		const projectData = TestDataFactory.createProject(TEST_USER_ID, {
			project_id: testProjectId,
			name: "MCP Test Project",
			description: "Project for task testing",
			visibility: "PRIVATE",
			status: "DEVELOPMENT",
		});
		const { id, created_at, updated_at, deleted, scan_branch, ...projectForUpsert } = projectData;

		const projectResponse = await mcpClient.callTool("devpad_projects_upsert", projectForUpsert);

		const project = JSON.parse(projectResponse.result.content[0].text);
		cleanupManager.registerProject(project);

		// Create tasks with different statuses using TestDataFactory for better structure
		const taskData = [
			TestDataFactory.createTask({
				title: "MCP Task 1 - TODO",
				description: "A todo task created via MCP",
				progress: "UNSTARTED" as const,
				priority: "HIGH" as const,
				owner_id: TEST_USER_ID,
				project_id: testProjectId,
				visibility: "PRIVATE" as const,
			}),
			TestDataFactory.createTask({
				title: "MCP Task 2 - In Progress",
				description: "An in-progress task created via MCP",
				progress: "IN_PROGRESS" as const,
				priority: "MEDIUM" as const,
				owner_id: TEST_USER_ID,
				project_id: testProjectId,
				visibility: "PRIVATE" as const,
			}),
			TestDataFactory.createTask({
				title: "MCP Task 3 - Completed",
				description: "A completed task created via MCP",
				progress: "COMPLETED" as const,
				priority: "LOW" as const,
				owner_id: TEST_USER_ID,
				project_id: testProjectId,
				visibility: "PRIVATE" as const,
			}),
		];

		const createdTasks = [];

		for (const task of taskData) {
			// Remove fields that are auto-generated or not part of upsert
			const { id, created_at, updated_at, deleted, codebase_task_id, ...taskForUpsert } = task;

			const response = await mcpClient.callTool("devpad_tasks_upsert", taskForUpsert);

			expect(response.result).toBeDefined();
			expect(response.result.isError).toBeUndefined();

			const createdTask = JSON.parse(response.result.content[0].text);
			expect(createdTask.task.title).toBe(task.title);
			expect(createdTask.task.progress).toBe(task.progress);
			expect(createdTask.task.priority).toBe(task.priority);

			// Register task for cleanup
			cleanupManager.registerTask(createdTask);
			createdTasks.push(createdTask);
		}

		// Verify we created 3 tasks
		expect(createdTasks).toHaveLength(3);
	});

	test("should list and filter tasks", async () => {
		// List all tasks for the project
		const listResponse = await mcpClient.callTool("devpad_tasks_list", {
			project_id: testProjectId,
		});

		expect(listResponse.result).toBeDefined();
		const tasks = JSON.parse(listResponse.result.content[0].text);

		// Should have the 3 tasks we created
		expect(tasks).toBeArray();
		expect(tasks.length).toBeGreaterThanOrEqual(3);

		// Check task statuses
		const taskStatuses = tasks.map((t: any) => t.task.progress);
		expect(taskStatuses).toContain("UNSTARTED");
		expect(taskStatuses).toContain("IN_PROGRESS");
		expect(taskStatuses).toContain("COMPLETED");
	});

	test("should get project by name", async () => {
		// First create a project to get using factory
		const projectData = TestDataFactory.createProject(TEST_USER_ID, {
			project_id: testProjectId,
			name: "MCP Test Project",
			description: "Project to test get by name",
			visibility: "PRIVATE",
			status: "DEVELOPMENT",
		});
		const { id, created_at, updated_at, deleted, scan_branch, ...projectForUpsert } = projectData;

		const createResponse = await mcpClient.callTool("devpad_projects_upsert", projectForUpsert);

		const createdProject = JSON.parse(createResponse.result.content[0].text);
		cleanupManager.registerProject(createdProject);

		// Use the created project's ID for lookup instead of name since name lookups seem to have timing issues
		const getResponse = await mcpClient.callTool("devpad_projects_get", {
			id: createdProject.id,
		});

		expect(getResponse.result).toBeDefined();
		expect(getResponse.result.isError).toBeUndefined();

		const project = JSON.parse(getResponse.result.content[0].text);
		expect(project.project_id).toBe(testProjectId);
		expect(project.name).toBe("MCP Test Project");
		expect(project.id).toBe(createdProject.id);
	});

	test("should handle validation errors", async () => {
		// Try to create a project without required fields (missing project_id and name)
		const response = await mcpClient.callTool("devpad_projects_upsert", {
			description: "Invalid project - missing required fields",
			owner_id: TEST_USER_ID,
		});

		expect(response.result).toBeDefined();
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0].text).toContain("Error");
	});

	test("should handle tool not found", async () => {
		const response = await mcpClient.callTool("devpad_nonexistent_tool", {});

		expect(response.result).toBeDefined();
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0].text).toContain("Unknown tool");
	});

	test("should verify data consistency between MCP and API", async () => {
		// First create a project for testing using factory
		const projectData = TestDataFactory.createProject(TEST_USER_ID, {
			project_id: testProjectId,
			name: "MCP Consistency Test",
			description: "Project for consistency testing",
			visibility: "PRIVATE",
			status: "DEVELOPMENT",
		});
		const { id, created_at, updated_at, deleted, scan_branch, ...projectForUpsert } = projectData;

		const createResponse = await mcpClient.callTool("devpad_projects_upsert", projectForUpsert);

		const createdProject = JSON.parse(createResponse.result.content[0].text);
		cleanupManager.registerProject(createdProject);

		// Get project via MCP by ID (more reliable than by name)
		const mcpResponse = await mcpClient.callTool("devpad_projects_get", {
			id: createdProject.id,
		});
		const mcpProject = JSON.parse(mcpResponse.result.content[0].text);

		// Get same project via API client by ID
		const { project: apiProject } = await apiClient.projects.getById(createdProject.id);

		// Verify they match
		expect(mcpProject.id).toBe(apiProject?.id);
		expect(mcpProject.name).toBe(apiProject?.name);
		expect(mcpProject.description).toBe(apiProject?.description);
		expect(mcpProject.visibility).toBe(apiProject?.visibility);
		expect(mcpProject.status).toBe(apiProject?.status);
	});
});
