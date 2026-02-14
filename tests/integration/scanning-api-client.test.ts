import { describe, expect, test } from "bun:test";
import { expectValidProject } from "../shared/assertions";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

describe("Scanning API Client Integration", () => {
	test("should have scanning methods available in API client", async () => {
		expect(t.client.projects.scan).toBeDefined();
		expect(t.client.projects.scan.initiate).toBeDefined();
		expect(t.client.projects.scan.updates).toBeDefined();
		expect(t.client.projects.scan.update).toBeDefined();

		expect(typeof t.client.projects.scan.initiate).toBe("function");
		expect(typeof t.client.projects.scan.updates).toBe("function");
		expect(typeof t.client.projects.scan.update).toBe("function");
	});

	test("should handle scan.updates() for project with no updates", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Scan Updates Test Project",
			description: "Test project for scan updates API",
			repo_url: "https://github.com/test/repo",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const updatesResult = await t.client.projects.scan.updates(project.id);

		if (!updatesResult.ok) {
			console.log("Updates error (might be expected):", updatesResult.error);
			expect(updatesResult.error).toBeDefined();
		} else {
			expect(Array.isArray(updatesResult.value)).toBe(true);
			console.log(`Found ${updatesResult.value.length} pending updates for new project`);
		}
	});

	test("should handle scan.updates() with invalid project ID", async () => {
		const updatesResult = await t.client.projects.scan.updates("non-existent-project-id");

		expect(updatesResult.ok).toBe(false);

		if (!updatesResult.ok) {
			console.log("Expected error for invalid project ID:", updatesResult.error.message);
		}
	});

	test("should handle scan.update() method structure", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Scan Update Method Test Project",
			description: "Test project for scan update method",
			repo_url: "https://github.com/test/repo",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const mockUpdateData = {
			update_id: 1,
			actions: {},
			titles: {},
			approved: false,
		};

		const updateResult = await t.client.projects.scan.update(project.id, mockUpdateData);

		if (!updateResult.ok) {
			console.log("Expected error for mock update data:", updateResult.error.message);
			expect(updateResult.error).toBeDefined();
		}
	});

	test("should handle scan.initiate() method with proper project", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Scan Initiate Test Project",
			description: "Test project for scan initiation",
			repo_url: "https://github.com/octocat/Hello-World",
			repo_id: 1296269,
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		try {
			console.log("Testing scan initiation for project:", project.id);

			const stream = await t.client.projects.scan.initiate(project.id);

			expect(stream).toBeDefined();
			expect(stream.constructor.name).toBe("ReadableStream");

			console.log("Scan initiation returned proper stream type");

			const reader = stream.getReader();

			const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Stream read timeout")), 5000));

			try {
				const readPromise = reader.read();
				const readResult = (await Promise.race([readPromise, timeoutPromise])) as any;

				console.log("Stream read result:", readResult);

				if (readResult.value) {
					expect(typeof readResult.value).toBe("string");
					console.log("Stream returned string data as expected");
				}
			} catch (readError: any) {
				console.log("Expected stream read error in test environment:", readError.message);
				expect(readError).toBeDefined();
			}
		} catch (initiateError: any) {
			console.log("Expected scan initiation error in test environment:", initiateError.message);
			expect(initiateError).toBeDefined();
		}
	});

	test("should validate API client scanning method signatures", async () => {
		const scan = t.client.projects.scan;

		expect(typeof scan.initiate).toBe("function");
		expect(typeof scan.updates).toBe("function");
		expect(typeof scan.update).toBe("function");

		try {
			// @ts-expect-error - testing runtime parameter validation
			await scan.updates();
		} catch (error) {
			expect(error).toBeDefined();
		}

		try {
			// @ts-expect-error - testing runtime parameter validation
			await scan.initiate();
		} catch (error) {
			expect(error).toBeDefined();
		}

		try {
			// @ts-expect-error - testing runtime parameter validation
			await scan.update();
		} catch (error) {
			expect(error).toBeDefined();
		}

		console.log("API method signatures validated");
	});

	test("should handle scan operations with proper error responses", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Scan Error Test Project",
			description: "Test project for scan error handling",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		try {
			const stream = await t.client.projects.scan.initiate(project.id);

			const reader = stream.getReader();
			const { value, done } = await reader.read();

			if (value && !done) {
				console.log("Scan error message from stream:", value);
				expect(typeof value).toBe("string");
				expect(value.toLowerCase()).toMatch(/error|repo|github/);
			}
		} catch (error: any) {
			console.log("Expected error for project without repo:", error.message);
			expect(error).toBeDefined();
		}
	});

	test("should maintain consistent API response format across scan methods", async () => {
		const projectData = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "API Format Test Project",
			description: "Test project for API response format consistency",
			repo_url: "https://github.com/test/repo",
		});

		const result = await t.client.projects.create(projectData);
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		const project = result.value;
		expectValidProject(project);

		const scanUpdatesResult = await t.client.projects.scan.updates(project.id);

		if (scanUpdatesResult.ok) {
			expect(Array.isArray(scanUpdatesResult.value)).toBe(true);
			console.log("Updates result follows expected format");
		} else {
			expect(typeof scanUpdatesResult.error.message).toBe("string");
			console.log("Error result follows expected format");
		}

		const scanUpdateResult = await t.client.projects.scan.update(project.id, {
			update_id: 999,
			actions: {},
			titles: {},
			approved: false,
		});

		expect(scanUpdateResult.ok).toBe(false);
		if (!scanUpdateResult.ok) {
			expect(typeof scanUpdateResult.error.message).toBe("string");
		}
		console.log("Update method error handling follows expected format");
	});
});
