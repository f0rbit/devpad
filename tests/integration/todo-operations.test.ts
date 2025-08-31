import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupIntegrationTests, teardownIntegrationTests, TEST_USER_ID } from './setup';
import { DevpadApiClient, UpsertTag } from '@devpad/api';
import { TestDataFactory } from './factories';
import { Tag } from '../../packages/app/src/server/types';

describe('todo operations API integration', () => {
	let test_client: DevpadApiClient;

	beforeAll(async () => {
		test_client = await setupIntegrationTests();
	});

	afterAll(async () => {
		await teardownIntegrationTests();
	});

	test('should upsert todo with basic fields', async () => {
		const task = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			title: 'Test Todo Task',
			description: 'This is a test todo description',
			summary: 'Test summary',
			progress: 'UNSTARTED',
			visibility: 'PRIVATE',
			priority: 'MEDIUM',
		});

		const created = await test_client.tasks.create(task);

		expect(created.task.title).toBe(task.title);
		expect(created.task.description).toBe(task.description);
		expect(created.task.progress).toBe(task.progress);
		expect(created.task.owner_id).toBe(task.owner_id);
	});

	test('should upsert todo with tags', async () => {
		// First create a project to associate the todo with
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);

		const task = TestDataFactory.createTask({
			title: 'Todo with Tags',
			description: 'Todo that includes custom tags',
			progress: 'IN_PROGRESS' as const,
			visibility: 'PRIVATE' as const,
			priority: 'HIGH' as const,
			owner_id: TEST_USER_ID,
			project_id: project.id
		});

		const tags: UpsertTag[] = [
			{
				id: TestDataFactory.getNextId(),
				title: 'urgent',
				color: 'red',
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true,
			},
			{
				id: TestDataFactory.getNextId(),
				title: 'backend',
				color: 'blue',
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true,
			}
		];

		const created = await test_client.tasks.create({ ...task, tags});

		expect(created.task.title).toBe(task.title);
		expect(created.task.project_id).toBe(project.id);
		expect(created.tags).toBeDefined();
		expect(Array.isArray(created.tags)).toBe(true);
	});

	test('should update existing todo', async () => {
		// Create initial todo
		const initial = TestDataFactory.createTask({
			title: 'Initial Todo',
			description: 'Initial description',
			progress: 'UNSTARTED' as const,
			owner_id: 'test-user-12345',
			priority: 'LOW' as const
		});

		const created = await test_client.tasks.create(initial);

		expect(created.task.title).toBe(initial.title);
		expect(created.task.progress).toBe(initial.progress);

		// Update the todo
		const upsert = {
			...initial,
			id: created.task.id,
			title: 'Updated Todo Title',
			description: 'Updated description',
			progress: 'COMPLETED' as const,
			owner_id: 'test-user-12345',
			priority: 'HIGH' as const
		};
		const updated = await test_client.tasks.update(created.task.id, upsert);

		expect(updated.task.id).toBe(created.task.id);
		expect(updated.task.title).toBe(upsert.title);
		expect(updated.task.progress).toBe(upsert.progress);
		expect(updated.task.priority).toBe(upsert.priority);
	});

	test('should save tags independently', async () => {
		const tags: UpsertTag[] = [
			{
				title: 'frontend',
				color: 'green' as const,
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true
			},
			{
				title: 'testing',
				color: 'yellow' as const,
				owner_id: TEST_USER_ID,
				deleted: false,
				render: true
			}
		];

		const savedTags = await test_client.tasks.saveTags(tags);
		
		expect(Array.isArray(savedTags)).toBe(true);
		expect(savedTags.length).toBe(2);
		expect(savedTags.find(t => t.title === 'frontend')).toBeDefined();
		expect(savedTags.find(t => t.title === 'testing')).toBeDefined();
	});

	test('should handle authorization for todo operations', async () => {
		// Test unauthorized access to upsert todo
		const response = await fetch('http://localhost:4321/api/v0/tasks', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json'
				// No authorization header
			},
			body: JSON.stringify({
				title: 'Unauthorized Todo',
				owner_id: 'test-user-12345'
			})
		});

		expect(response.status).toBe(401);

		// Test unauthorized access to save tags
		const tagsResponse = await fetch('http://localhost:4321/api/v0/tasks/save_tags', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json'
				// No authorization header
			},
			body: JSON.stringify([])
		});

		expect(tagsResponse.status).toBe(401);
	});

	test('should validate todo schema', async () => {
		// Send invalid todo data
		const invalidTodo = {
			// Missing required owner_id
			title: 'Invalid Todo',
			progress: 'INVALID_STATUS' // Invalid progress value
		};

		try {
			await test_client.tasks.create(invalidTodo as any);
			expect(false).toBe(true); // Should not reach here
		} catch (error: any) {
			expect(error).toBeDefined();
			expect(error.message).toContain('Invalid input');
		}
	});

	test('should validate tag schema', async () => {
		// Send invalid tag data
		const invalidTags = [
			{
				// Missing required title
				color: 'red',
				owner_id: TEST_USER_ID
			}
		];

		try {
			await test_client.tasks.saveTags(invalidTags as any);
			expect(false).toBe(true); // Should not reach here
		} catch (error: any) {
			expect(error).toBeDefined();
			expect(error.message).toContain('Invalid input');
		}
	});

	test('should handle owner authorization for todos', async () => {
		// Try to create a todo for a different user
		const todoData = {
			title: 'Unauthorized Todo',
			owner_id: 'different-user-id', // Different from authenticated user
			progress: 'UNSTARTED' as const
		};
		try {
			await test_client.tasks.create(todoData);
			expect(false).toBe(true); // Should not reach here
		} catch (error: any) {
			expect(error).toBeDefined();
			expect(error.message).toContain('Invalid or expired API key');
		}
	});
});