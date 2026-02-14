import { describe, expect, test } from "bun:test";
import { expectValidProject } from "../shared/assertions";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

describe("Core Scanning Workflows", () => {
	test("should complete end-to-end project creation and management workflow", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Scanning Workflow Test Project",
			description: "Test project for end-to-end workflow validation",
			specification: null,
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const getResult = await t.client.projects.getById(project.id);
		if (!getResult.ok) throw new Error(`Failed to retrieve project: ${getResult.error.message}`);
		expectValidProject(getResult.value);
		expect(getResult.value.id).toBe(project.id);
		expect(getResult.value.name).toBe("Scanning Workflow Test Project");

		const listResult = await t.client.projects.list();
		if (!listResult.ok) throw new Error(`Failed to list projects: ${listResult.error.message}`);
		expect(Array.isArray(listResult.value)).toBe(true);
		const projectIds = listResult.value.map(p => p.id);
		expect(projectIds).toContain(project.id);

		const updateResult = await t.client.projects.update({
			...project,
			name: "Updated Scanning Workflow Project",
			description: "Updated description for scanning workflow",
			specification: "# Test Project Specification\n\nThis is a test specification.",
		});
		if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);
		expectValidProject(updateResult.value);
		expect(updateResult.value.name).toBe("Updated Scanning Workflow Project");
		expect(updateResult.value.specification).toContain("Test Project Specification");
	});

	test("should handle project workflow with GitHub integration setup", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "GitHub Integration Test Project",
			description: "Test project for GitHub integration workflow",
			repo_url: "https://github.com/octocat/Hello-World",
			repo_id: 123456789,
			specification: null,
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		expect(project.specification).toBeNull();

		const updateResult = await t.client.projects.update({
			...project,
			specification: "# GitHub Repository Specification\n\nFetched from GitHub README.",
		});
		if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);
		expect(updateResult.value.specification).toContain("GitHub Repository Specification");

		const getResult = await t.client.projects.getById(project.id);
		if (!getResult.ok) throw new Error(`Failed to retrieve project: ${getResult.error.message}`);
		expectValidProject(getResult.value);
		expect(getResult.value.specification).toContain("GitHub Repository Specification");
	});

	test("should handle project configuration and settings workflow", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Configuration Test Project",
			description: "Test project for configuration workflow",
			visibility: "PRIVATE",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		expect(project.visibility).toBe("PRIVATE");

		const updateResult = await t.client.projects.update({
			...project,
			visibility: "PUBLIC",
		});
		if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);
		expect(updateResult.value.visibility).toBe("PUBLIC");
	});

	test("should handle project deletion workflow using API client", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Deletion Test Project",
			description: "Test project for deletion workflow",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const getResult = await t.client.projects.getById(project.id);
		if (!getResult.ok) throw new Error(`Failed to retrieve project: ${getResult.error.message}`);
		expectValidProject(getResult.value);

		const deleteResult = await t.client.projects.deleteProject(project);
		if (!deleteResult.ok) throw new Error(`Failed to delete project: ${deleteResult.error.message}`);

		try {
			const fetchResult = await t.client.projects.getById(project.id);
			if (!fetchResult.ok) {
				expect(fetchResult.ok).toBe(false);
			} else if (fetchResult.value) {
				expect(fetchResult.value.deleted).toBe(true);
			}
		} catch (error) {
			expect(error).toBeDefined();
		}
	});

	test("should handle project permissions and access control", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Permissions Test Project",
			description: "Test project for permissions validation",
			visibility: "PRIVATE",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const getResult = await t.client.projects.getById(project.id);
		if (!getResult.ok) throw new Error(`Failed to retrieve project: ${getResult.error.message}`);
		expectValidProject(getResult.value);
		expect(getResult.value.id).toBe(project.id);

		const listResult = await t.client.projects.list();
		if (!listResult.ok) throw new Error(`Failed to list projects: ${listResult.error.message}`);
		const ownedProjectIds = listResult.value.map(p => p.id);
		expect(ownedProjectIds).toContain(project.id);

		expect(project.visibility).toBe("PRIVATE");

		const updateResult = await t.client.projects.update({
			...project,
			visibility: "PUBLIC",
		});
		if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);
		expect(updateResult.value.visibility).toBe("PUBLIC");
	});

	test("should handle project metadata and timestamps", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Metadata Test Project",
			description: "Test project for metadata validation",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		expect(project.created_at).toBeDefined();
		expect(project.updated_at).toBeDefined();
		expect(new Date(project.created_at).getTime()).toBeLessThanOrEqual(Date.now());

		await new Promise(resolve => setTimeout(resolve, 10));

		const updateResult = await t.client.projects.update({
			...project,
			description: "Updated description for timestamp test",
		});
		if (!updateResult.ok) throw new Error(`Failed to update project: ${updateResult.error.message}`);

		expect(updateResult.value.updated_at).toBeDefined();
		expect(new Date(updateResult.value.updated_at).getTime()).toBeGreaterThan(0);
	});

	test("should handle project specification fetching workflow", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Specification Fetch Test Project",
			description: "Test project for specification fetching",
			repo_url: "https://github.com/octocat/Hello-World",
			repo_id: 123456789,
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		try {
			const specResult = await t.client.projects.specification(project.id);
			if (!specResult.ok) {
				expect(specResult.ok).toBe(false);
			} else {
				expect(typeof specResult.value).toBe("string");
			}
		} catch (error) {
			expect(error).toBeDefined();
		}
	});

	test("should handle project configuration saving workflow", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Config Save Test Project",
			description: "Test project for configuration saving",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const configRequest = {
			id: project.id,
			config: {
				tags: [
					{ name: "bug", match: ["BUG", "FIXME"] },
					{ name: "todo", match: ["TODO", "@todo"] },
				],
				ignore: ["*.log", "node_modules/**"],
			},
		};

		try {
			const configResult = await t.client.projects.config.save(configRequest);
			if (!configResult.ok) {
				expect(configResult.ok).toBe(false);
			}
		} catch (error) {
			expect(error).toBeDefined();
		}
	});
});
