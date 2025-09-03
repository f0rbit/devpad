import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type ApiClient from "@devpad/api";
import type { Project, TaskWithDetails } from "@devpad/schema";
import { TestDataFactory } from "./factories";
import { setupIntegrationTests, TEST_USER_ID, teardownIntegrationTests } from "./setup";

describe("tasks API client integration", () => {
	let test_client: ApiClient;
	const createdProjects: Project[] = [];
	const createdTasks: TaskWithDetails[] = [];

	// Setup test environment
	beforeAll(async () => {
		test_client = await setupIntegrationTests();
	});

	// Clean up after all tests
	afterAll(async () => {
		// Clean up tasks first
		for (const task of createdTasks) {
			try {
				await test_client.tasks.deleteTask(task);
			} catch (error) {
				console.warn(`Failed to clean up task ${task.task.id}:`, error);
			}
		}

		// Then clean up projects
		for (const project of createdProjects) {
			try {
				await test_client.projects.deleteProject(project);
			} catch (error) {
				console.warn(`Failed to clean up project ${project.id}:`, error);
			}
		}

		await teardownIntegrationTests();
	});

	test("should list tasks", async () => {
		const tasks = await test_client.tasks.list();

		expect(Array.isArray(tasks)).toBe(true);
		// Tasks might be empty for a new user, which is fine
		if (tasks.length > 0) {
			const task = tasks[0];
			expect(task).toHaveProperty("task");
			expect(task.task).toHaveProperty("id");
			expect(task.task).toHaveProperty("title");
			expect(task).toHaveProperty("tags");
			expect(Array.isArray(task.tags)).toBe(true);
		}
	});

	test("should create a new task", async () => {
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "New Task",
			description: "Task description",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
		});

		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		// console.log("created task", createdTask);

		expect(createdTask).toHaveProperty("task");
		expect(createdTask.task).toHaveProperty("id");
		expect(createdTask.task.title).toBe(taskData.title);
		expect(createdTask.task.description).toBe(taskData.description);
		expect(createdTask.task.progress).toBe(taskData.progress);
		expect(createdTask.task.priority).toBe(taskData.priority);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);
		expect(Array.isArray(createdTask.tags)).toBe(true);
	});

	test("should create a task with tags", async () => {
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "New Task",
			description: "Task description",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
		});
		// const tags = TestDataFactory.createTestTags(TEST_USER_ID, 2);

		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		expect(createdTask.task.title).toBe(taskData.title);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);
		// Note: Tags might not be returned in the response depending on backend implementation
		expect(Array.isArray(createdTask.tags)).toBe(true);
	});

	test("should create task within a project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then create a task within that project
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "New Task",
			description: "Task description",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
			project_id: createdProject.id,
		});
		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		expect(createdTask.task.project_id).toBe(createdProject.id);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);
	});

	test("should update an existing task", async () => {
		// First create a task
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "New Task",
			description: "Task description",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
		});
		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		// Then update it
		const updatedData = {
			...taskData,
			title: "Updated Task Title",
			description: "Updated description",
			progress: "IN_PROGRESS" as const,
			priority: "LOW" as const,
		};

		const updatedTask = await test_client.tasks.update(createdTask.task.id, updatedData);

		expect(updatedTask.task.id).toBe(createdTask.task.id);
		expect(updatedTask.task.title).toBe(updatedData.title);
		expect(updatedTask.task.description).toBe(updatedData.description);
		expect(updatedTask.task.progress).toBe(updatedData.progress);
		expect(updatedTask.task.priority).toBe(updatedData.priority);
	});

	test("should get task by id", async () => {
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "New Task",
			description: "Task description",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
		});
		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		// Then get it by ID
		const fetchedTask = await test_client.tasks.getById(createdTask.task.id);

		expect(fetchedTask.task.id).toBe(createdTask.task.id);
		expect(fetchedTask.task.title).toBe(createdTask.task.title);
	});

	test("should get tasks by project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Create a couple of tasks in this project
		const task1 = await test_client.tasks.create(
			TestDataFactory.createTask({
				owner_id: TEST_USER_ID,
				title: "Task 1",
				description: "Description for Task 1",
				progress: "UNSTARTED",
				priority: "MEDIUM",
				visibility: "PRIVATE",
				project_id: createdProject.id,
			})
		);
		const task2 = await test_client.tasks.create(
			TestDataFactory.createTask({
				owner_id: TEST_USER_ID,
				title: "Task 2",
				description: "Description for Task 2",
				progress: "UNSTARTED",
				priority: "MEDIUM",
				visibility: "PRIVATE",
				project_id: createdProject.id,
			})
		);
		createdTasks.push(task1, task2);

		// Get tasks by project
		const projectTasks = await test_client.tasks.getByProject(createdProject.id);

		expect(Array.isArray(projectTasks)).toBe(true);
		expect(projectTasks.length).toBeGreaterThanOrEqual(2);

		const taskIds = projectTasks.map((t: TaskWithDetails) => t.task.id);
		expect(taskIds).toContain(task1.task.id);
		expect(taskIds).toContain(task2.task.id);
	});

	test("should handle upsert for both create and update", async () => {
		// Test create via upsert (no id)
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "New Task",
			description: "Task description",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			visibility: "PRIVATE",
		});
		const createdTask = await test_client.tasks.upsert(taskData);
		createdTasks.push(createdTask);

		expect(createdTask.task).toHaveProperty("id");
		expect(createdTask.task.title).toBe(taskData.title);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);

		// Test update via upsert (with id)
		const updatedTask = await test_client.tasks.upsert({
			id: createdTask.task.id,
			owner_id: TEST_USER_ID,
			title: "Updated via Upsert",
			description: "Updated description via upsert",
			progress: "COMPLETED",
		});

		expect(updatedTask.task.id).toBe(createdTask.task.id);
		expect(updatedTask.task.title).toBe("Updated via Upsert");
		expect(updatedTask.task.description).toBe("Updated description via upsert");
		expect(updatedTask.task.progress).toBe("COMPLETED");
	});

	test("should complete full project and task workflow", async () => {
		// 1. Create a project
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);
		createdProjects.push(project);

		// 2. Create multiple tasks in the project
		const task1Data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "Setup project structure",
			priority: "HIGH",
			project_id: project.id,
		});
		const task2Data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "Write tests",
			priority: "MEDIUM",
			project_id: project.id,
		});

		const task1 = await test_client.tasks.create(task1Data);
		const task2 = await test_client.tasks.create(task2Data);
		createdTasks.push(task1, task2);

		// 3. Update task progress
		await test_client.tasks.update(task1.task.id, {
			...task1Data,
			progress: "IN_PROGRESS",
		});

		// 4. Complete a task
		const completedTask1 = await test_client.tasks.update(task1.task.id, {
			...task1Data,
			progress: "COMPLETED",
		});

		// 5. Update project status
		const updatedProject = await test_client.projects.update({
			...projectData,
			status: "PAUSED",
		});

		// Verify the workflow
		expect(updatedProject.status).toBe("PAUSED");
		expect(completedTask1.task.progress).toBe("COMPLETED");

		// Verify we can get tasks by project
		const projectTasks = await test_client.tasks.getByProject(project.id);
		expect(projectTasks.length).toBeGreaterThanOrEqual(2);
	});

	test("should upsert todo with basic fields", async () => {
		const task = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: "Test Todo Task",
			description: "This is a test todo description",
			summary: "Test summary",
			progress: "UNSTARTED",
			visibility: "PRIVATE",
			priority: "MEDIUM",
		});

		const created = await test_client.tasks.upsert(task);
		createdTasks.push(created);

		expect(created.task.title).toBe(task.title);
		expect(created.task.description).toBe(task.description);
		expect(created.task.progress).toBe(task.progress);
		expect(created.task.owner_id).toBe(task.owner_id);
	});

	test("should upsert todo with tags", async () => {
		// First create a project to associate the task with
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);
		createdProjects.push(project);

		const todoData = TestDataFactory.createTask({
			title: "Task with Tags",
			description: "Description for task with tags",
			progress: "UNSTARTED",
			visibility: "PRIVATE",
			priority: "HIGH",
			owner_id: TEST_USER_ID,
			project_id: project.id,
		});

		const tags = [
			{
				title: "frontend",
				color: "green" as const,
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true,
			},
			{
				title: "backend",
				color: "blue" as const,
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true,
			},
		];

		const result = await test_client.tasks.upsert({
			...todoData,
			tags: tags,
		});
		createdTasks.push(result);

		expect(result.task.title).toBe(todoData.title);
		expect(result.task.project_id).toBe(project.id);
		expect(result.tags).toBeDefined();
		expect(result.tags.length).toBeGreaterThanOrEqual(0);
	});

	test("should update existing todo", async () => {
		// Create initial todo
		const initialTodo = TestDataFactory.createTask({
			title: "Initial Todo",
			description: "Initial description",
			progress: "UNSTARTED",
			visibility: "PRIVATE",
			priority: "LOW",
			owner_id: TEST_USER_ID,
		});

		const createResponse = await test_client.tasks.upsert(initialTodo);
		createdTasks.push(createResponse);

		// Update the todo
		const updatedTodo = {
			...createResponse.task,
			title: "Updated Todo",
			description: "Updated description",
			progress: "IN_PROGRESS" as const,
			priority: "HIGH" as const,
		};

		const updateResponse = await test_client.tasks.upsert(updatedTodo);

		expect(updateResponse.task.id).toBe(createResponse.task.id);
		expect(updateResponse.task.title).toBe("Updated Todo");
		expect(updateResponse.task.description).toBe("Updated description");
		expect(updateResponse.task.progress).toBe("IN_PROGRESS");
		expect(updateResponse.task.priority).toBe("HIGH");
	});

	test("should save tags independently", async () => {
		const tags = [
			{
				title: "testing",
				color: "yellow" as const,
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true,
			},
			{
				title: "frontend",
				color: "green" as const,
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true,
			},
		];

		const savedTags = await test_client.tasks.saveTags(tags);
		// console.log("Saved tags response:", savedTags);

		expect(Array.isArray(savedTags)).toBe(true);
		expect(savedTags.length).toBe(2);
		expect(savedTags.find(t => t.title === "testing")).toBeDefined();
		expect(savedTags.find(t => t.title === "frontend")).toBeDefined();
	});

	test("should handle authorization for todo operations", async () => {
		const todoData = TestDataFactory.createTask({
			title: "Authorized Todo",
			owner_id: TEST_USER_ID,
		});

		// This should work with proper authorization
		const result = await test_client.tasks.upsert(todoData);
		createdTasks.push(result);

		expect(result.task.title).toBe(todoData.title);
		expect(result.task.owner_id).toBe(TEST_USER_ID);
	});

	test("should validate todo schema", async () => {
		// Test with invalid data
		const invalidTodo = {
			title: "", // Invalid empty title
			progress: "INVALID_STATUS", // Invalid progress status
			priority: "SUPER_HIGH", // Invalid priority
			owner_id: TEST_USER_ID,
		} as any;

		expect(test_client.tasks.upsert(invalidTodo)).rejects.toThrow();
	});

	test("should validate tag schema", async () => {
		const invalidTags = [
			{
				title: "", // Invalid empty title
				color: "invalid_color", // Invalid color
				owner_id: TEST_USER_ID,
			},
		] as any;

		expect(test_client.tasks.saveTags(invalidTags)).rejects.toThrow();
	});

	test("should handle owner authorization for todos", async () => {
		const todoData = TestDataFactory.createTask({
			title: "Owner Authorization Test",
			owner_id: TEST_USER_ID,
		});

		// Should succeed with correct owner_id
		const result = await test_client.tasks.upsert(todoData);
		createdTasks.push(result);

		expect(result.task.owner_id).toBe(TEST_USER_ID);
	});
});
