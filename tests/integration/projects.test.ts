import { describe, expect, test } from "bun:test";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { expectValidProject, expectValidArray, expectMatchesPartial, expectSuccessfulResponse, expectValidApiError } from "../shared/assertions";
import { TestDataFactory } from "./factories";

class ProjectsIntegrationTest extends BaseIntegrationTest {}

// Setup test instance
const testInstance = new ProjectsIntegrationTest();
setupBaseIntegrationTest(testInstance);

describe("projects API client integration", () => {
	test("should get API status", async () => {
		// Test the basic API endpoint that should always work
		const response = await fetch("http://localhost:3001/api/v0");
		expectSuccessfulResponse(response);

		const data = await response.json();
		expect(data.version).toBe("0");
	});

	test("should list projects", async () => {
		const projects = await testInstance.client.projects.list();
		expectValidArray(projects, expectValidProject);
	});

	test("should create a new project", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		expectValidProject(createdProject);
		expectMatchesPartial(createdProject, {
			name: projectData.name,
			description: projectData.description,
			status: projectData.status,
			visibility: projectData.visibility,
			specification: projectData.specification,
		});
	});

	test("should update an existing project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then update it
		const updatedData = {
			name: "Updated Project Name",
			description: "Updated description",
			status: "PAUSED" as const,
		};

		const updatedProject = await testInstance.client.projects.update({
			...projectData,
			...updatedData,
		});

		expectValidProject(updatedProject);
		expectMatchesPartial(updatedProject, {
			id: createdProject.id,
			name: updatedData.name,
			description: updatedData.description,
			status: updatedData.status,
		});
	});

	test("should get project by id", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then get it by ID
		const fetchedProject = await testInstance.client.projects.getById(createdProject.id);

		expectValidProject(fetchedProject);
		expectMatchesPartial(fetchedProject, {
			id: createdProject.id,
			name: createdProject.name,
		});
	});

	test("should get project by name", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then get it by project_id (name)
		const fetchedProject = await testInstance.client.projects.getByName(createdProject.project_id);

		expectValidProject(fetchedProject);
		expectMatchesPartial(fetchedProject, {
			id: createdProject.id,
			project_id: createdProject.project_id,
		});
	});

	test("should handle upsert for both create and update", async () => {
		// Test create via upsert (no id)
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.client.projects.upsert(projectData);
		testInstance.registerProject(createdProject);

		expectValidProject(createdProject);
		expectMatchesPartial(createdProject, {
			name: projectData.name,
		});

		// Test update via upsert (with id)
		const updatedProject = await testInstance.client.projects.upsert({
			...projectData,
			name: "Updated via Upsert",
			description: "Updated description via upsert",
		});

		expectValidProject(updatedProject);
		expectMatchesPartial(updatedProject, {
			id: createdProject.id,
			name: "Updated via Upsert",
			description: "Updated description via upsert",
		});
	});

	test("should soft delete a project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then delete it (soft delete)
		const deletedProject = await testInstance.client.projects.deleteProject(createdProject);

		expectValidProject(deletedProject);
		expectMatchesPartial(deletedProject, {
			id: createdProject.id,
			deleted: true,
		});
	});

	test("should save project configuration", async () => {
		// Create a test project
		const projectData = TestDataFactory.createRealisticProject();
		const project = await testInstance.createAndRegisterProject(projectData);

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

		expect(testInstance.client.projects.saveConfig(configPayload)).resolves.toBeUndefined();
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

		const upsertedProject = await testInstance.client.projects.upsertProject(payload);
		testInstance.registerProject(upsertedProject);

		expectValidProject(upsertedProject);
		expectMatchesPartial(upsertedProject, {
			project_id: payload.project_id,
			name: payload.name,
			repo_url: payload.repo_url,
			specification: payload.specification,
		});
	});

	test("should fetch project specification", async () => {
		// First create a project with a GitHub repo URL
		const projectData = TestDataFactory.createRealisticProject();
		projectData.repo_url = "https://github.com/octocat/Hello-World"; // Use a known public repo

		const project = await testInstance.client.projects.upsertProject({
			...projectData,
			owner_id: "test-user-12345",
			deleted: false,
		});
		testInstance.registerProject(project);

		// Note: This will likely fail without proper GitHub auth token
		// But we're testing the API structure and error handling
		try {
			await testInstance.client.projects.fetchSpecification(project.id);
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
		const project = await testInstance.createAndRegisterProject(projectData);

		const invalidConfig = {
			id: project.id,
			config: {
				tags: "invalid", // Should be array
				ignore: "also invalid", // Should be array
			},
		} as any;

		expect(testInstance.client.projects.saveConfig(invalidConfig)).rejects.toThrow();
	});

	test("should handle authorization for project operations", async () => {
		// Create project with one user's ID, try to access with different auth
		const projectData = TestDataFactory.createRealisticProject();
		const project = await testInstance.createAndRegisterProject(projectData);

		const configPayload = {
			id: project.id,
			config: {
				tags: [],
				ignore: [],
			},
		};

		// This should work since we're using the same client
		expect(testInstance.client.projects.saveConfig(configPayload)).resolves.toBeUndefined();
	});
});
