import { test, expect, describe, afterAll } from 'bun:test';
import { test_client, TEST_USER_ID } from './setup';
import { TestDataFactory } from '../fixtures/factories';
import type { Project } from '@/src/server/projects';
import type { _FetchedTask, Task } from '@/src/server/tasks';

describe('tasks API client integration', () => {
	const createdProjects: Project[] = [];
	const createdTasks: Task[] = [];

	// Clean up after all tests
	afterAll(async () => {
		// Clean up tasks first
		for (const task of createdTasks) {
			try {
				await test_client.tasks.delete(task);
			} catch (error) {
				console.warn(`Failed to clean up task ${task.task.id}:`, error);
			}
		}

		// Then clean up projects
		for (const project of createdProjects) {
			try {
				await test_client.projects.delete(project);
			} catch (error) {
				console.warn(`Failed to clean up project ${project.id}:`, error);
			}
		}
	});

	test('should list tasks', async () => {
		const tasks = await test_client.tasks.list();

		expect(Array.isArray(tasks)).toBe(true);
		// Tasks might be empty for a new user, which is fine
		if (tasks.length > 0) {
			const task = tasks[0];
			expect(task).toHaveProperty('task');
			expect(task.task).toHaveProperty('id');
			expect(task.task).toHaveProperty('title');
			expect(task).toHaveProperty('tags');
			expect(Array.isArray(task.tags)).toBe(true);
		}
	});

	test('should create a new task', async () => {
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'New Task',
			description: 'Task description',
			progress: 'UNSTARTED',
			priority: 'MEDIUM',
			visibility: 'PRIVATE',
		});

		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		console.log("created task", createdTask);

		expect(createdTask).toHaveProperty('task');
		expect(createdTask.task).toHaveProperty('id');
		expect(createdTask.task.title).toBe(taskData.title);
		expect(createdTask.task.description).toBe(taskData.description);
		expect(createdTask.task.progress).toBe(taskData.progress);
		expect(createdTask.task.priority).toBe(taskData.priority);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);
		expect(Array.isArray(createdTask.tags)).toBe(true);
	});

	test('should create a task with tags', async () => {
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'New Task',
			description: 'Task description',
			progress: 'UNSTARTED',
			priority: 'MEDIUM',
			visibility: 'PRIVATE',
		});
		const tags = TestDataFactory.createTestTags(TEST_USER_ID, 2);

		const createdTask = await test_client.tasks.create({ ...taskData, tags });
		createdTasks.push(createdTask);

		expect(createdTask.task.title).toBe(taskData.title);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);
		// Note: Tags might not be returned in the response depending on backend implementation
		expect(Array.isArray(createdTask.tags)).toBe(true);
	});

	test('should create task within a project', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then create a task within that project
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'New Task',
			description: 'Task description',
			progress: 'UNSTARTED',
			priority: 'MEDIUM',
			visibility: 'PRIVATE',
			project_id: createdProject.id
		});
		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		expect(createdTask.task.project_id).toBe(createdProject.id);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);
	});

	test('should update an existing task', async () => {
		// First create a task
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'New Task',
			description: 'Task description',
			progress: 'UNSTARTED',
			priority: 'MEDIUM',
			visibility: 'PRIVATE',
		});
		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		// Then update it
		const updatedData = {
			...taskData,
			title: 'Updated Task Title',
			description: 'Updated description',
			progress: 'IN_PROGRESS' as const,
			priority: 'LOW' as const
		};

		const updatedTask = await test_client.tasks.update(createdTask.task.id, updatedData);

		expect(updatedTask.task.id).toBe(createdTask.task.id);
		expect(updatedTask.task.title).toBe(updatedData.title);
		expect(updatedTask.task.description).toBe(updatedData.description);
		expect(updatedTask.task.progress).toBe(updatedData.progress);
		expect(updatedTask.task.priority).toBe(updatedData.priority);
	});

	test('should get task by id', async () => {
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'New Task',
			description: 'Task description',
			progress: 'UNSTARTED',
			priority: 'MEDIUM',
			visibility: 'PRIVATE',
		});
		const createdTask = await test_client.tasks.create(taskData);
		createdTasks.push(createdTask);

		// Then get it by ID
		const fetchedTask = await test_client.tasks.get(createdTask.task.id);

		expect(fetchedTask.task.id).toBe(createdTask.task.id);
		expect(fetchedTask.task.title).toBe(createdTask.task.title);
	});

	test('should get tasks by project', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Create a couple of tasks in this project
		const task1 = await test_client.tasks.create(
			TestDataFactory.createTask({
				owner_id: TEST_USER_ID,
				title: 'Task 1',
				description: 'Description for Task 1',
				progress: 'UNSTARTED',
				priority: 'MEDIUM',
				visibility: 'PRIVATE',
				project_id: createdProject.id
			})
		);
		const task2 = await test_client.tasks.create(
			TestDataFactory.createTask({
				owner_id: TEST_USER_ID,
				title: 'Task 2',
				description: 'Description for Task 2',
				progress: 'UNSTARTED',
				priority: 'MEDIUM',
				visibility: 'PRIVATE',
				project_id: createdProject.id
			})
		);
		createdTasks.push(task1, task2);

		// Get tasks by project
		const projectTasks = await test_client.tasks.getByProject(createdProject.id);

		expect(Array.isArray(projectTasks)).toBe(true);
		expect(projectTasks.length).toBeGreaterThanOrEqual(2);

		const taskIds = projectTasks.map(t => t.task.id);
		expect(taskIds).toContain(task1.task.id);
		expect(taskIds).toContain(task2.task.id);
	});

	test('should handle upsert for both create and update', async () => {
		// Test create via upsert (no id)
		const taskData = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'New Task',
			description: 'Task description',
			progress: 'UNSTARTED',
			priority: 'MEDIUM',
			visibility: 'PRIVATE',
		});
		const createdTask = await test_client.tasks.upsert(taskData);
		createdTasks.push(createdTask);

		expect(createdTask.task).toHaveProperty('id');
		expect(createdTask.task.title).toBe(taskData.title);
		expect(createdTask.task.owner_id).toBe(TEST_USER_ID);

		// Test update via upsert (with id)
		const updatedTask = await test_client.tasks.upsert({
			id: createdTask.task.id,
			owner_id: TEST_USER_ID,
			title: 'Updated via Upsert',
			description: 'Updated description via upsert',
			progress: 'COMPLETED'
		});

		expect(updatedTask.task.id).toBe(createdTask.task.id);
		expect(updatedTask.task.title).toBe('Updated via Upsert');
		expect(updatedTask.task.description).toBe('Updated description via upsert');
		expect(updatedTask.task.progress).toBe('COMPLETED');
	});

	test('should complete full project and task workflow', async () => {
		// 1. Create a project
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);
		createdProjects.push(project);

		// 2. Create multiple tasks in the project
		const task1Data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'Setup project structure',
			priority: 'HIGH',
			project_id: project.id,
		});
		const task2Data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'Write tests',
			priority: 'MEDIUM',
			project_id: project.id,
		});

		const task1 = await test_client.tasks.create(task1Data);
		const task2 = await test_client.tasks.create(task2Data);
		createdTasks.push(task1, task2);

		// 3. Update task progress
		await test_client.tasks.update(task1.task.id, {
			...task1Data,
			progress: 'IN_PROGRESS'
		});

		// 4. Complete a task
		const completedTask1 = await test_client.tasks.update(task1.task.id, {
			...task1Data,
			progress: 'COMPLETED'
		});

		// 5. Update project status
		const updatedProject = await test_client.projects.update({
			...projectData,
			status: 'PAUSED'
		});

		// Verify the workflow
		expect(updatedProject.status).toBe('PAUSED');
		expect(completedTask1.task.progress).toBe('COMPLETED');

		// Verify we can get tasks by project
		const projectTasks = await test_client.tasks.getByProject(project.id);
		expect(projectTasks.length).toBeGreaterThanOrEqual(2);
	});
});