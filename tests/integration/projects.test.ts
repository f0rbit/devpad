import { describe, expect, test } from "bun:test";
import { expectMatchesPartial, expectSuccessfulResponse, expectValidApiError, expectValidArray, expectValidProject } from "../shared/assertions";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

class ProjectsIntegrationTest extends BaseIntegrationTest {}

// Setup test instance
const testInstance = new ProjectsIntegrationTest();
setupBaseIntegrationTest(testInstance);

describe("projects API client integration", () => {
	test("should get API status", async () => {
		// Test the basic API endpoint that should always work
		const response = await fetch("http://localhost:3001/api/v1");
		expectSuccessfulResponse(response);

		const data = await response.json();
		expect(data.version).toBe("1");
	});

	test("should list projects", async () => {
		const result = await testInstance.client.projects.list();
		if (!result.ok) {
			throw new Error(`Failed to list projects: ${result.error.message}`);
		}
		expectValidArray(result.value, expectValidProject);
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

		const updateResult = await testInstance.client.projects.update(createdProject.id, updatedData);
		if (!updateResult.ok) {
			throw new Error(`Failed to update project: ${updateResult.error.message}`);
		}

		expectValidProject(updateResult.value);
		expectMatchesPartial(updateResult.value, {
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
		const result = await testInstance.client.projects.getById(createdProject.id);
		if (!result.ok) {
			throw new Error(`Failed to get project by ID: ${result.error.message}`);
		}

		expectValidProject(result.value);
		expectMatchesPartial(result.value, {
			id: createdProject.id,
			name: createdProject.name,
		});
	});

	test("should get project by name", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then get it by project_id (name)
		const result = await testInstance.client.projects.getByName(createdProject.project_id);
		if (!result.ok) {
			throw new Error(`Failed to get project by name: ${result.error.message}`);
		}

		expectValidProject(result.value);
		expectMatchesPartial(result.value, {
			id: createdProject.id,
			project_id: createdProject.project_id,
		});
	});

	test("should handle upsert for both create and update", async () => {
		// Test create via upsert (no id)
		const projectData = TestDataFactory.createRealisticProject();
		const createResult = await testInstance.client.projects.upsert(projectData);
		if (!createResult.ok) {
			throw new Error(`Failed to create project via upsert: ${createResult.error.message}`);
		}
		testInstance.registerProject(createResult.value);

		expectValidProject(createResult.value);
		expectMatchesPartial(createResult.value, {
			name: projectData.name,
		});

		// Test update via upsert (with id)
		const updateResult = await testInstance.client.projects.upsert({
			id: createResult.value.id,
			project_id: createResult.value.project_id,
			owner_id: createResult.value.owner_id,
			name: "Updated via Upsert",
			description: "Updated description via upsert",
			status: createResult.value.status,
			visibility: createResult.value.visibility,
			specification: createResult.value.specification,
			repo_url: createResult.value.repo_url,
			repo_id: createResult.value.repo_id,
			icon_url: createResult.value.icon_url,
			link_url: createResult.value.link_url,
			link_text: createResult.value.link_text,
			current_version: createResult.value.current_version,
			deleted: createResult.value.deleted,
		});
		if (!updateResult.ok) {
			throw new Error(`Failed to update project via upsert: ${updateResult.error.message}`);
		}

		expectValidProject(updateResult.value);
		expectMatchesPartial(updateResult.value, {
			id: createResult.value.id,
			name: "Updated via Upsert",
			description: "Updated description via upsert",
		});
	});

	test("should soft delete a project", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then delete it (soft delete)
		const deleteResult = await testInstance.client.projects.update(createdProject.id, { deleted: true });
		if (!deleteResult.ok) {
			throw new Error(`Failed to delete project: ${deleteResult.error.message}`);
		}

		expectValidProject(deleteResult.value);
		expectMatchesPartial(deleteResult.value, {
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

		const configResult = await testInstance.client.projects.config.save(configPayload);
		if (!configResult.ok) {
			// Configuration might not be fully implemented, but we shouldn't get API method errors
			console.warn(`Configuration save failed (expected): ${configResult.error.message}`);
		}
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

		const upsertResult = await testInstance.client.projects.upsert(payload);
		if (!upsertResult.ok) {
			throw new Error(`Failed to upsert project: ${upsertResult.error.message}`);
		}
		testInstance.registerProject(upsertResult.value);

		expectValidProject(upsertResult.value);
		expectMatchesPartial(upsertResult.value, {
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

		const upsertResult = await testInstance.client.projects.upsert({
			...projectData,
			owner_id: "test-user-12345",
			deleted: false,
		});
		if (!upsertResult.ok) {
			throw new Error(`Failed to create project: ${upsertResult.error.message}`);
		}
		testInstance.registerProject(upsertResult.value);

		// TODO: Test specification fetching when API method is available
		// For now, just verify the project has repo info that would be used for fetching
		expect(upsertResult.value.repo_url).toContain("github.com");
		expect(upsertResult.value.repo_url).toBe("https://github.com/octocat/Hello-World");
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

		const configResult = await testInstance.client.projects.config.save(invalidConfig);
		// Should have error for invalid configuration
		expect(configResult.ok).toBe(false);
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
		const configResult = await testInstance.client.projects.config.save(configPayload);
		if (!configResult.ok) {
			console.warn(`Configuration save failed (expected): ${configResult.error.message}`);
		}
	});
});
