import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupIntegrationTests, teardownIntegrationTests } from './setup';
import { DevpadApiClient } from '@devpad/api';
import { TestDataFactory } from './factories';
import { Task } from '../../packages/app/src/server/tasks';
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
		const todoData = {
			title: 'Test Todo Task',
			description: 'This is a test todo description',
			summary: 'Test summary',
			progress: 'UNSTARTED' as const,
			visibility: 'PRIVATE' as const,
			priority: 'MEDIUM' as const,
			owner_id: 'test-user-12345', // This should match the test user ID from setup
			project_id: null,
			start_time: null,
			end_time: null
		};

		const response = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(todoData)
		});

		expect(response.status).toBe(200);
		
		const createdTodo = await response.json();
		expect(createdTodo.task.title).toBe(todoData.title);
		expect(createdTodo.task.description).toBe(todoData.description);
		expect(createdTodo.task.progress).toBe(todoData.progress);
		expect(createdTodo.task.owner_id).toBe(todoData.owner_id);
	});

	test('should upsert todo with tags', async () => {
		// First create a project to associate the todo with
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);

		const todoData = {
			title: 'Todo with Tags',
			description: 'Todo that includes custom tags',
			progress: 'IN_PROGRESS' as const,
			visibility: 'PRIVATE' as const,
			priority: 'HIGH' as const,
			owner_id: 'test-user-12345',
			project_id: project.id
		};

		const tags = [
			{
				title: 'urgent',
				color: 'red' as const,
				owner_id: 'test-user-12345',
				deleted: false,
				render: true
			},
			{
				title: 'backend',
				color: 'blue' as const,
				owner_id: 'test-user-12345',
				deleted: false,
				render: true
			}
		];

		const response = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify({
				...todoData,
				tags: tags
			})
		});

		expect(response.status).toBe(200);
		
		const result = await response.json();
		expect(result.task.title).toBe(todoData.title);
		expect(result.task.project_id).toBe(project.id);
		expect(result.tags).toBeDefined();
		expect(Array.isArray(result.tags)).toBe(true);
	});

	test('should update existing todo', async () => {
		// Create initial todo
		const initialTodo = {
			title: 'Initial Todo',
			description: 'Initial description',
			progress: 'UNSTARTED' as const,
			owner_id: 'test-user-12345',
			priority: 'LOW' as const
		};

		const createResponse = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(initialTodo)
		});

		expect(createResponse.status).toBe(200);
		const created = await createResponse.json();

		// Update the todo
		const updatedTodo = {
			id: created.task.id,
			title: 'Updated Todo Title',
			description: 'Updated description',
			progress: 'COMPLETED' as const,
			owner_id: 'test-user-12345',
			priority: 'HIGH' as const
		};

		const updateResponse = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(updatedTodo)
		});

		expect(updateResponse.status).toBe(200);
		const updated = await updateResponse.json();
		expect(updated.task.id).toBe(created.task.id);
		expect(updated.task.title).toBe(updatedTodo.title);
		expect(updated.task.progress).toBe(updatedTodo.progress);
		expect(updated.task.priority).toBe(updatedTodo.priority);
	});

	test('should save tags independently', async () => {
		const tags = [
			{
				title: 'frontend',
				color: 'green' as const,
				owner_id: 'test-user-12345',
				deleted: false,
				render: true
			},
			{
				title: 'testing',
				color: 'yellow' as const,
				owner_id: 'test-user-12345',
				deleted: false,
				render: true
			}
		];

		const response = await fetch('http://localhost:4321/api/todo/save_tags', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(tags)
		});

		expect(response.status).toBe(200);
		
		const savedTags = await response.json() as Tag[];
		console.log('Saved tags response:', savedTags);
		expect(Array.isArray(savedTags)).toBe(true);
		expect(savedTags.length).toBe(2);
		expect(savedTags.find(t => t.title === 'frontend')).toBeDefined();
		expect(savedTags.find(t => t.title === 'testing')).toBeDefined();
	});

	test('should handle authorization for todo operations', async () => {
		// Test unauthorized access to upsert todo
		const response = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
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
		const tagsResponse = await fetch('http://localhost:4321/api/todo/save_tags', {
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

		const response = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(invalidTodo)
		});

		expect(response.status).toBe(400);
	});

	test('should validate tag schema', async () => {
		// Send invalid tag data
		const invalidTags = [
			{
				// Missing required title
				color: 'red',
				owner_id: 'test-user-12345'
			}
		];

		const response = await fetch('http://localhost:4321/api/todo/save_tags', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(invalidTags)
		});

		expect(response.status).toBe(400);
	});

	test('should handle owner authorization for todos', async () => {
		// Try to create a todo for a different user
		const todoData = {
			title: 'Unauthorized Todo',
			owner_id: 'different-user-id', // Different from authenticated user
			progress: 'UNSTARTED' as const
		};

		const response = await fetch('http://localhost:4321/api/todo/upsert', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(todoData)
		});

		expect(response.status).toBe(401);
	});
});