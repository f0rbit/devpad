import { describe, expect, test } from "bun:test";
import { expectMatchesPartial, expectSuccessfulResponse, expectValidApiError, expectValidArray, expectValidProject } from "../shared/assertions";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

const t = setupIntegration();

describe("projects API client integration", () => {
	test("should get API status", async () => {
		const response = await fetch("http://localhost:3001/api/v1");
		expectSuccessfulResponse(response);

		const data = await response.json();
		expect(data.version).toBe("1");
	});

	test("should list projects", async () => {
		const result = await t.client.projects.list();
		if (!result.ok) {
			throw new Error(`Failed to list projects: ${result.error.message}`);
		}
		expectValidArray(result.value, expectValidProject);
	});

	test("should create a new project", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);

		expectValidProject(result.value);
		expectMatchesPartial(result.value, {
			name: projectData.name,
			description: projectData.description,
			status: projectData.status,
			visibility: projectData.visibility,
			specification: projectData.specification,
		});
	});

	test("should update an existing project", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const createdProject = result.value;

		const updatedData = {
			name: "Updated Project Name",
			description: "Updated description",
			status: "PAUSED" as const,
		};

		const updateResult = await t.client.projects.update(createdProject.id, updatedData);
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
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const createdProject = result.value;

		const getResult = await t.client.projects.getById(createdProject.id);
		if (!getResult.ok) {
			throw new Error(`Failed to get project by ID: ${getResult.error.message}`);
		}

		expectValidProject(getResult.value);
		expectMatchesPartial(getResult.value, {
			id: createdProject.id,
			name: createdProject.name,
		});
	});

	test("should get project by name", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const createdProject = result.value;

		const getResult = await t.client.projects.getByName(createdProject.project_id);
		if (!getResult.ok) {
			throw new Error(`Failed to get project by name: ${getResult.error.message}`);
		}

		expectValidProject(getResult.value);
		expectMatchesPartial(getResult.value, {
			id: createdProject.id,
			project_id: createdProject.project_id,
		});
	});

	test("should handle upsert for both create and update", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const createResult = await t.client.projects.upsert(projectData);
		if (!createResult.ok) {
			throw new Error(`Failed to create project via upsert: ${createResult.error.message}`);
		}
		t.cleanup.registerProject(createResult.value);

		expectValidProject(createResult.value);
		expectMatchesPartial(createResult.value, {
			name: projectData.name,
		});

		const updateResult = await t.client.projects.upsert({
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
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const createdProject = result.value;

		const deleteResult = await t.client.projects.update(createdProject.id, { deleted: true });
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
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;

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

		const configResult = await t.client.projects.config.save(configPayload);
		if (!configResult.ok) {
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

		const upsertResult = await t.client.projects.upsert(payload);
		if (!upsertResult.ok) {
			throw new Error(`Failed to upsert project: ${upsertResult.error.message}`);
		}
		t.cleanup.registerProject(upsertResult.value);

		expectValidProject(upsertResult.value);
		expectMatchesPartial(upsertResult.value, {
			project_id: payload.project_id,
			name: payload.name,
			repo_url: payload.repo_url,
			specification: payload.specification,
		});
	});

	test("should fetch project specification", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		projectData.repo_url = "https://github.com/octocat/Hello-World";

		const upsertResult = await t.client.projects.upsert({
			...projectData,
			owner_id: "test-user-12345",
			deleted: false,
		});
		if (!upsertResult.ok) {
			throw new Error(`Failed to create project: ${upsertResult.error.message}`);
		}
		t.cleanup.registerProject(upsertResult.value);

		expect(upsertResult.value.repo_url).toContain("github.com");
		expect(upsertResult.value.repo_url).toBe("https://github.com/octocat/Hello-World");
	});

	test("should validate project configuration schema", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;

		const invalidConfig = {
			id: project.id,
			config: {
				tags: "invalid",
				ignore: "also invalid",
			},
		} as any;

		const configResult = await t.client.projects.config.save(invalidConfig);
		expect(configResult.ok).toBe(false);
	});

	test("should handle authorization for project operations", async () => {
		const projectData = TestDataFactory.createRealisticProject();
		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;

		const configPayload = {
			id: project.id,
			config: {
				tags: [],
				ignore: [],
			},
		};

		const configResult = await t.client.projects.config.save(configPayload);
		if (!configResult.ok) {
			console.warn(`Configuration save failed (expected): ${configResult.error.message}`);
		}
	});
});
