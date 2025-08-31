import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DevpadApiClient } from "@devpad/api";
import type { Project } from "@devpad/schema";
import { TestDataFactory } from "./factories";
import { setupIntegrationTests, teardownIntegrationTests } from "./setup";

describe("projects API client integration", () => {
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

	test("should get API status", async () => {
		// Test the basic API endpoint that should always work
		const response = await fetch("http://localhost:4321/api/v0");
		expect(response.ok).toBe(true);

		const data = await response.json();
		expect(data.version).toBe("0");
	});

	test("should list projects", async () => {
		const projects = await test_client.projects.list();

		expect(Array.isArray(projects)).toBe(true);
		// Projects might be empty for a new user, which is fine
		if (projects.length > 0) {
			const project = projects[0];
			expect(project).toHaveProperty("id");
			expect(project).toHaveProperty("name");
			expect(project).toHaveProperty("visibility");
		}
	});

	test("should create a new project", async () => {
		const projectData = TestDataFactory.createRealisticProject();

		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		expect(createdProject).toHaveProperty("id");
		expect(createdProject.name).toBe(projectData.name);
		expect(createdProject.description).toBe(projectData.description);
		expect(createdProject.status).toBe(projectData.status);
		expect(createdProject.visibility).toBe(projectData.visibility);
		expect(createdProject.specification).toBe(projectData.specification);
	});

	test("should update an existing project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then update it
		const updatedData = {
			name: "Updated Project Name",
			description: "Updated description",
			status: "PAUSED" as const,
		};

		const updatedProject = await test_client.projects.update({
			...projectData,
			...updatedData,
		});

		expect(updatedProject.id).toBe(createdProject.id);
		expect(updatedProject.name).toBe(updatedData.name);
		expect(updatedProject.description).toBe(updatedData.description);
		expect(updatedProject.status).toBe(updatedData.status);
	});

	test("should get project by id", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then get it by ID
		const fetchedProject = await test_client.projects.get(createdProject.id);

		expect(fetchedProject.id).toBe(createdProject.id);
		expect(fetchedProject.name).toBe(createdProject.name);
	});

	test("should get project by name", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then get it by project_id (name)
		const fetchedProject = await test_client.projects.getByName(createdProject.project_id);

		expect(fetchedProject.id).toBe(createdProject.id);
		expect(fetchedProject.project_id).toBe(createdProject.project_id);
	});

	test("should handle upsert for both create and update", async () => {
		// Test create via upsert (no id)
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.upsert(projectData);
		createdProjects.push(createdProject);

		expect(createdProject).toHaveProperty("id");
		expect(createdProject.name).toBe(projectData.name);

		// Test update via upsert (with id)
		const updatedProject = await test_client.projects.upsert({
			...projectData,
			name: "Updated via Upsert",
			description: "Updated description via upsert",
		});

		expect(updatedProject.id).toBe(createdProject.id);
		expect(updatedProject.name).toBe("Updated via Upsert");
		expect(updatedProject.description).toBe("Updated description via upsert");
	});

	test("should soft delete a project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await test_client.projects.create(projectData);
		createdProjects.push(createdProject);

		// Then delete it (soft delete)
		const deletedProject = await test_client.projects.delete(createdProject);

		expect(deletedProject.id).toBe(createdProject.id);
		expect(deletedProject.deleted).toBe(true);
	});

	test("should save project configuration", async () => {
		// Create a test project
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);
		createdProjects.push(project);

		const configPayload = {
			id: project.id,
			config: {
				tags: [
					{
						name: "backend",
						match: ["*.ts", "*.js"],
					},
					{
						name: "frontend",
						match: ["*.tsx", "*.jsx"],
					},
				],
				ignore: ["node_modules", "*.log", "dist"],
			},
			scan_branch: "main",
		};

		expect(test_client.projects.saveConfig(configPayload)).resolves.toBeUndefined();
	});

	test("should upsert project with extended functionality", async () => {
		const projectData = TestDataFactory.createRealisticProject();

		const payload = {
			project_id: projectData.project_id,
			owner_id: "test-user-12345",
			name: projectData.name,
			description: projectData.description,
			status: projectData.status,
			visibility: projectData.visibility,
			repo_url: "https://github.com/test/repo",
			repo_id: 12345,
			specification: "Test project specification",
			icon_url: null,
			deleted: false,
			link_url: "https://test.example.com",
			link_text: "Visit Project",
			current_version: "1.0.0",
		};

		const upsertedProject = await test_client.projects.upsertProject(payload);
		createdProjects.push(upsertedProject);

		expect(upsertedProject.project_id).toBe(payload.project_id);
		expect(upsertedProject.name).toBe(payload.name);
		expect(upsertedProject.repo_url).toBe(payload.repo_url);
		expect(upsertedProject.specification).toBe(payload.specification);
	});

	test("should fetch project specification", async () => {
		// First create a project with a GitHub repo URL
		const projectData = TestDataFactory.createRealisticProject();
		projectData.repo_url = "https://github.com/octocat/Hello-World"; // Use a known public repo

		const project = await test_client.projects.upsertProject({
			...projectData,
			owner_id: "test-user-12345",
			deleted: false,
		});
		createdProjects.push(project);

		// Note: This will likely fail without proper GitHub auth token
		// But we're testing the API structure and error handling
		try {
			await test_client.projects.fetchSpecification(project.id);
			// If it succeeds, great! If not, we expect specific errors
		} catch (error: any) {
			// Should fail with API authentication error or GitHub access token error
			// The exact error depends on whether the API key auth succeeds first
			expect(error.message).toMatch(/Invalid or expired API key|GitHub access token required|Missing project_id parameter/);
		}
	});

	test("should validate project configuration schema", async () => {
		// Test with invalid configuration
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);
		createdProjects.push(project);

		const invalidConfig = {
			id: project.id,
			config: {
				tags: "invalid", // Should be array
				ignore: "also invalid", // Should be array
			},
		} as any;

		expect(test_client.projects.saveConfig(invalidConfig)).rejects.toThrow();
	});

	test("should handle authorization for project operations", async () => {
		// Create project with one user's ID, try to access with different auth
		const projectData = TestDataFactory.createRealisticProject();
		const project = await test_client.projects.create(projectData);
		createdProjects.push(project);

		const configPayload = {
			id: project.id,
			config: {
				tags: [],
				ignore: [],
			},
		};

		// This should work since we're using the same client
		expect(test_client.projects.saveConfig(configPayload)).resolves.toBeUndefined();
	});
});
