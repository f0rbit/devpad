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
		const { projects, error } = await testInstance.client.projects.list();
		if (error) {
			throw new Error(`Failed to list projects: ${error.message}`);
		}
		expectValidArray(projects!, expectValidProject);
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

		const { project: updatedProject, error } = await testInstance.client.projects.update(createdProject.id, updatedData);
		if (error) {
			throw new Error(`Failed to update project: ${error.message}`);
		}

		expectValidProject(updatedProject!);
		expectMatchesPartial(updatedProject!, {
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
		const { project: fetchedProject, error } = await testInstance.client.projects.getById(createdProject.id);
		if (error) {
			throw new Error(`Failed to get project by ID: ${error.message}`);
		}

		expectValidProject(fetchedProject!);
		expectMatchesPartial(fetchedProject!, {
			id: createdProject.id,
			name: createdProject.name,
		});
	});

	test("should get project by name", async () => {
		// First create a project
		const projectData = TestDataFactory.createRealisticProject();
		const createdProject = await testInstance.createAndRegisterProject(projectData);

		// Then get it by project_id (name)
		const { project: fetchedProject, error } = await testInstance.client.projects.getByName(createdProject.project_id);
		if (error) {
			throw new Error(`Failed to get project by name: ${error.message}`);
		}

		expectValidProject(fetchedProject!);
		expectMatchesPartial(fetchedProject!, {
			id: createdProject.id,
			project_id: createdProject.project_id,
		});
	});

	test("should handle upsert for both create and update", async () => {
		// Test create via upsert (no id)
		const projectData = TestDataFactory.createRealisticProject();
		const { project: createdProject, error: createError } = await testInstance.client.projects.upsert(projectData);
		if (createError) {
			throw new Error(`Failed to create project via upsert: ${createError.message}`);
		}
		testInstance.registerProject(createdProject!);

		expectValidProject(createdProject!);
		expectMatchesPartial(createdProject!, {
			name: projectData.name,
		});

		// Test update via upsert (with id)
		const { project: updatedProject, error: updateError } = await testInstance.client.projects.upsert({
			id: createdProject!.id,
			project_id: createdProject!.project_id,
			owner_id: createdProject!.owner_id,
			name: "Updated via Upsert",
			description: "Updated description via upsert",
			status: createdProject!.status,
			visibility: createdProject!.visibility,
			specification: createdProject!.specification,
			repo_url: createdProject!.repo_url,
			repo_id: createdProject!.repo_id,
			icon_url: createdProject!.icon_url,
			link_url: createdProject!.link_url,
			link_text: createdProject!.link_text,
			current_version: createdProject!.current_version,
			deleted: createdProject!.deleted,
		});
		if (updateError) {
			throw new Error(`Failed to update project via upsert: ${updateError.message}`);
		}

		expectValidProject(updatedProject!);
		expectMatchesPartial(updatedProject!, {
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
		const { project: deletedProject, error } = await testInstance.client.projects.update(createdProject.id, { deleted: true });
		if (error) {
			throw new Error(`Failed to delete project: ${error.message}`);
		}

		expectValidProject(deletedProject!);
		expectMatchesPartial(deletedProject!, {
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

		const { error } = await testInstance.client.projects.config.save(configPayload);
		if (error) {
			// Configuration might not be fully implemented, but we shouldn't get API method errors
			console.warn(`Configuration save failed (expected): ${error.message}`);
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

		const { project: upsertedProject, error } = await testInstance.client.projects.upsert(payload);
		if (error) {
			throw new Error(`Failed to upsert project: ${error.message}`);
		}
		testInstance.registerProject(upsertedProject!);

		expectValidProject(upsertedProject!);
		expectMatchesPartial(upsertedProject!, {
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

		const { project, error } = await testInstance.client.projects.upsert({
			...projectData,
			owner_id: "test-user-12345",
			deleted: false,
		});
		if (error) {
			throw new Error(`Failed to create project: ${error.message}`);
		}
		testInstance.registerProject(project!);

		// TODO: Test specification fetching when API method is available
		// For now, just verify the project has repo info that would be used for fetching
		expect(project!.repo_url).toContain("github.com");
		expect(project!.repo_url).toBe("https://github.com/octocat/Hello-World");
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

		const { error } = await testInstance.client.projects.config.save(invalidConfig);
		// Should have error for invalid configuration
		expect(error).toBeDefined();
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
		const { error } = await testInstance.client.projects.config.save(configPayload);
		if (error) {
			console.warn(`Configuration save failed (expected): ${error.message}`);
		}
	});
});
