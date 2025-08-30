import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { setupIntegrationTests, teardownIntegrationTests } from './setup';
import { TestDataFactory } from './factories';
import type { Project } from '@devpad/schema';
import type { DevpadApiClient } from '@devpad/api';

describe('projects API client integration', () => {
	let test_client: DevpadApiClient;
	const createdProjects: Project[] = [];

	// Setup test environment
	beforeAll(async () => {
		test_client = await setupIntegrationTests();
	});

	// Clean up after all tests
	afterAll(async () => {
		// Clean up any projects we created during testing
		for (const project of createdProjects) {
			try {
				await test_client.projects.delete(project);
			} catch (error) {
				console.warn(`Failed to clean up project ${project.id}:`, error);
			}
		}
		
		await teardownIntegrationTests();
	});

	test('should get API status', async () => {
		// Test the basic API endpoint that should always work
		const response = await fetch('http://localhost:4321/api/v0');
		expect(response.ok).toBe(true);

		const data = await response.json();
		expect(data.version).toBe("0");
	});

	test('should list projects', async () => {
		const projects = await test_client.projects.list();

		expect(Array.isArray(projects)).toBe(true);
		// Projects might be empty for a new user, which is fine
		if (projects.length > 0) {
			const project = projects[0];
			expect(project).toHaveProperty('id');
			expect(project).toHaveProperty('name');
			expect(project).toHaveProperty('visibility');
		}
	});

	test('should create a new project', async () => {
		const projectData = TestDataFactory.createRealisticProject();

		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		expect(createdProject).toHaveProperty('id');
		expect(createdProject.name).toBe(projectData.name);
		expect(createdProject.description).toBe(projectData.description);
		expect(createdProject.status).toBe(projectData.status);
		expect(createdProject.visibility).toBe(projectData.visibility);
		expect(createdProject.specification).toBe(projectData.specification);
	});

	test('should update an existing project', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then update it
		const updatedData = {
			name: 'Updated Project Name',
			description: 'Updated description',
			status: 'PAUSED' as const
		};

		const updatedProject = await test_client.projects.update({
			...projectData,
			...updatedData
		});

		expect(updatedProject.id).toBe(createdProject.id);
		expect(updatedProject.name).toBe(updatedData.name);
		expect(updatedProject.description).toBe(updatedData.description);
		expect(updatedProject.status).toBe(updatedData.status);
	});

	test('should get project by id', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then get it by ID
		const fetchedProject = await test_client.projects.get(createdProject.id);

		expect(fetchedProject.id).toBe(createdProject.id);
		expect(fetchedProject.name).toBe(createdProject.name);
	});

	test('should get project by name', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then get it by project_id (name)
		const fetchedProject = await test_client.projects.getByName(createdProject.project_id);

		expect(fetchedProject.id).toBe(createdProject.id);
		expect(fetchedProject.project_id).toBe(createdProject.project_id);
	});

	test('should handle upsert for both create and update', async () => {
		// Test create via upsert (no id)
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.upsert(projectData);
		createdProjects.push(createdProject);

		expect(createdProject).toHaveProperty('id');
		expect(createdProject.name).toBe(projectData.name);

		// Test update via upsert (with id)
		const updatedProject = await test_client.projects.upsert({
			...projectData,
			name: 'Updated via Upsert',
			description: 'Updated description via upsert'
		});

		expect(updatedProject.id).toBe(createdProject.id);
		expect(updatedProject.name).toBe('Updated via Upsert');
		expect(updatedProject.description).toBe('Updated description via upsert');
	});

	test('should soft delete a project', async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then delete it (soft delete)
		const deletedProject = await test_client.projects.delete(createdProject);

		expect(deletedProject.id).toBe(createdProject.id);
		expect(deletedProject.deleted).toBe(true);
	});
});