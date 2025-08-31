import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupIntegrationTests, teardownIntegrationTests } from './setup';
import { DevpadApiClient } from '@devpad/api';
import { TestDataFactory } from './factories';

describe('API client operations integration', () => {
	let test_client: DevpadApiClient;

	beforeAll(async () => {
		test_client = await setupIntegrationTests();
	});

	afterAll(async () => {
		await teardownIntegrationTests();
	});

	test('should upsert project via API client', async () => {
		const projectData = TestDataFactory.createRealisticProject();
		
		const request = {
			project_id: projectData.project_id,
			name: projectData.name,
			description: projectData.description,
			status: projectData.status as "DEVELOPMENT",
			visibility: projectData.visibility,
			repo_url: 'https://github.com/test/repo',
			repo_id: 12345,
			specification: 'Test project specification',
			icon_url: null,
			link_url: 'https://test.example.com',
			link_text: 'Visit Project',
			current_version: '1.0.0'
		};

		const upsertedProject = await test_client.projectOps.upsert(request);
		
		expect(upsertedProject.project_id).toBe(request.project_id);
		expect(upsertedProject.name).toBe(request.name);
		expect(upsertedProject.repo_url).toBe(request.repo_url);
		expect(upsertedProject.specification).toBe(request.specification);
	});

	test('should upsert todo via API client', async () => {
		const request = {
			title: 'API Client Todo',
			description: 'Created via API client',
			progress: 'UNSTARTED' as const,
			visibility: 'PRIVATE' as const,
			priority: 'MEDIUM' as const,
			owner_id: 'test-user-12345'
		};

		const result = await test_client.todoOps.upsert(request);
		
		expect(result.task.title).toBe(request.title);
		expect(result.task.description).toBe(request.description);
		expect(result.task.progress).toBe(request.progress);
		expect(result.task.owner_id).toBe(request.owner_id);
	});

	test('should save tags via API client', async () => {
		const tags = [
			{
				title: 'client-test',
				color: 'red' as const,
				owner_id: 'test-user-12345',
				deleted: false,
				render: true
			},
			{
				title: 'integration',
				color: 'blue' as const,
				owner_id: 'test-user-12345',
				deleted: false,
				render: true
			}
		];

		const savedTags = await test_client.todoOps.saveTags(tags);
		
		expect(Array.isArray(savedTags)).toBe(true);
		expect(savedTags.length).toBe(2);
		expect(savedTags.find(t => t.title === 'client-test')).toBeDefined();
		expect(savedTags.find(t => t.title === 'integration')).toBeDefined();
	});

	test('should save project configuration via API client', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);

		// Define a configuration to save
		const request = {
			id: project.id,
			config: {
				tags: [
					{
						name: 'api-test',
						match: ['*.ts', '*.js']
					}
				],
				ignore: ['node_modules', '*.log']
			},
			scan_branch: 'main'
		};

		// This might still fail due to the server-side issues we saw earlier
		// but at least we can test the client interface
		await expect(test_client.projectOps.saveConfig(request)).resolves.not.toThrow();
	});

	test('should handle API client errors gracefully', async () => {
		// Test with invalid project ID
		const request = {
			id: 'non-existent-project',
			config: {
				tags: [],
				ignore: []
			}
		};

		// Should throw an error but in a controlled way
		await expect(test_client.projectOps.saveConfig(request)).rejects.toThrow();
	});
});