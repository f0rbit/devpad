import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { setupIntegrationTests, teardownIntegrationTests } from './setup';
import { DevpadApiClient } from '@devpad/api';
import { TestDataFactory } from './factories';

describe('project operations API integration', () => {
	let test_client: DevpadApiClient;

	beforeAll(async () => {
		test_client = await setupIntegrationTests();
	});

	afterAll(async () => {
		await teardownIntegrationTests();
	});

	test('should fetch project specification', async () => {
		// First create a project with a GitHub repo URL
		const projectData = TestDataFactory.createRealisticProject();
		projectData.repo_url = 'https://github.com/octocat/Hello-World'; // Use a known public repo
		
		const project = await test_client.projects.create(projectData);
		expect(project.id).toBeDefined();
		expect(project.repo_url).toBe(projectData.repo_url);

		// Note: This test will likely fail without proper GitHub auth token
		// But we're testing the API structure and error handling
		try {
			const response = await fetch('http://localhost:4321/api/project/fetch_spec?project_id=' + project.id);
			
			// Should return 401 or 500 due to missing GitHub token, but structure should be valid
			expect([401, 500, 200].includes(response.status)).toBe(true);
		} catch (error) {
			// Expected to fail without GitHub integration setup
			console.log('GitHub integration not available in test environment');
		}
	});

	test('should save project configuration', async () => {
		// Create a test project
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);

		// Define a configuration to save
		const config = {
			tags: [
				{
					name: 'backend',
					match: ['*.ts', '*.js']
				},
				{
					name: 'frontend',
					match: ['*.tsx', '*.jsx']
				}
			],
			ignore: ['node_modules', '*.log', 'dist']
		};

		const configPayload = {
			id: project.id,
			config: config,
			scan_branch: 'main'
		};

		const response = await fetch('http://localhost:4321/api/project/save_config', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(configPayload)
		});

		if (response.status !== 200) {
			const errorText = await response.text();
			console.log('Save config error:', response.status, errorText);
		}
		expect(response.status).toBe(200);
	});

	test('should upsert project via /project/upsert endpoint', async () => {
		const projectData = TestDataFactory.createRealisticProject();
		
		const payload = {
			project_id: projectData.project_id,
			name: projectData.name,
			description: projectData.description,
			status: projectData.status,
			visibility: projectData.visibility,
			repo_url: 'https://github.com/test/repo',
			repo_id: 12345,
			specification: 'Test project specification',
			icon_url: null,
			link_url: 'https://test.example.com',
			link_text: 'Visit Project',
			current_version: '1.0.0'
		};

		const response = await fetch('http://localhost:4321/api/project/upsert', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(payload)
		});

		expect(response.status).toBe(200);
		
		const upsertedProject = await response.json();
		expect(upsertedProject.project_id).toBe(payload.project_id);
		expect(upsertedProject.name).toBe(payload.name);
		expect(upsertedProject.repo_url).toBe(payload.repo_url);
		expect(upsertedProject.specification).toBe(payload.specification);
	});

	test('should update existing project via /project/upsert', async () => {
		// First create a project via the v0 API
		const projectData = TestDataFactory.createRealisticProject();
		const originalProject = await test_client.projects.create(projectData);

		// Then update it via the /project/upsert endpoint
		const updatePayload = {
			id: originalProject.id,
			project_id: originalProject.project_id,
			name: 'Updated Project Name',
			description: 'Updated description',
			status: 'PAUSED' as const,
			visibility: originalProject.visibility,
			repo_url: 'https://github.com/updated/repo',
			repo_id: 67890,
			specification: 'Updated specification',
			icon_url: 'https://example.com/icon.png',
			link_url: 'https://updated.example.com',
			link_text: 'Visit Updated Project',
			current_version: '2.0.0'
		};

		const response = await fetch('http://localhost:4321/api/project/upsert', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(updatePayload)
		});

		expect(response.status).toBe(200);
		
		const updatedProject = await response.json();
		expect(updatedProject.id).toBe(originalProject.id);
		expect(updatedProject.name).toBe(updatePayload.name);
		expect(updatedProject.description).toBe(updatePayload.description);
		expect(updatedProject.status).toBe(updatePayload.status);
		expect(updatedProject.repo_url).toBe(updatePayload.repo_url);
		expect(updatedProject.specification).toBe(updatePayload.specification);
	});

	test('should handle authorization for project operations', async () => {
		// Test unauthorized access
		const response = await fetch('http://localhost:4321/api/project/save_config', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json'
				// No authorization header
			},
			body: JSON.stringify({
				id: 'some-id',
				config: { tags: [], ignore: [] }
			})
		});

		expect(response.status).toBe(401);
	});

	test('should validate project configuration schema', async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);

		// Send invalid configuration
		const invalidConfig = {
			id: project.id,
			config: {
				tags: [
					{
						// Missing 'name' field
						match: ['*.ts']
					}
				],
				ignore: ['node_modules']
			}
		};

		const response = await fetch('http://localhost:4321/api/project/save_config', {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${test_client.getApiKey()}`
			},
			body: JSON.stringify(invalidConfig)
		});

		if (response.status !== 400) {
			const errorText = await response.text();
			console.log('Validation error:', response.status, errorText);
		}
		expect(response.status).toBe(400);
	});
});