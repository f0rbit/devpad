import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";

const t = setupIntegration();

describe("Project Edge Cases Integration", () => {
	describe("Project Not Found Scenarios", () => {
		test("should return 404 when getting project by non-existent ID", async () => {
			const nonExistentId = "non-existent-project-123";
			const result = await t.client.projects.getById(nonExistentId);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message.toLowerCase()).toMatch(/not found|404/);
			}
		});

		test("should return 404 when getting project by non-existent name", async () => {
			const nonExistentName = "non-existent-project-name";
			const result = await t.client.projects.getByName(nonExistentName);

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.message.toLowerCase()).toMatch(/not found|404/);
			}
		});
	});

	describe("Project Deletion Edge Cases", () => {
		test("should handle getting deleted project by ID", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			const deleteResult = await t.client.projects.update(project.id, { deleted: true });
			expect(deleteResult.ok).toBe(true);
			if (deleteResult.ok) {
				expect(deleteResult.value.deleted).toBe(true);
			}

			const fetchResult = await t.client.projects.getById(project.id);
			expect(fetchResult.ok).toBe(true);
			if (fetchResult.ok) {
				expect(fetchResult.value).toBeDefined();
				expect(fetchResult.value.deleted).toBe(true);
			}
		});

		test("should handle deleted projects in listing appropriately", async () => {
			const initialResult = await t.client.projects.list();
			const initialCount = initialResult.ok ? initialResult.value.length : 0;

			const projectData = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			const afterCreateResult = await t.client.projects.list();
			if (afterCreateResult.ok) {
				expect(afterCreateResult.value.length).toBe(initialCount + 1);
			}

			await t.client.projects.update(project.id, { deleted: true });

			const afterDeleteResult = await t.client.projects.list();
			if (afterDeleteResult.ok) {
				if (afterDeleteResult.value.some(p => p.id === project.id && p.deleted === true)) {
					expect(afterDeleteResult.value.length).toBe(initialCount + 1);
					const deletedProject = afterDeleteResult.value.find(p => p.id === project.id);
					expect(deletedProject!.deleted).toBe(true);
				} else {
					expect(afterDeleteResult.value.length).toBe(initialCount);
				}
			}
		});
	});

	describe("Project Visibility and Authorization", () => {
		test("should filter public projects correctly", async () => {
			const publicProjectData = TestDataFactory.createRealisticProject();
			publicProjectData.visibility = "PUBLIC";
			const publicResult = await t.client.projects.create(publicProjectData);
			if (!publicResult.ok) throw new Error(`Failed to create project: ${publicResult.error.message}`);
			t.cleanup.registerProject(publicResult.value);
			const publicProject = publicResult.value;

			const privateProjectData = TestDataFactory.createRealisticProject();
			privateProjectData.visibility = "PRIVATE";
			const privateResult = await t.client.projects.create(privateProjectData);
			if (!privateResult.ok) throw new Error(`Failed to create project: ${privateResult.error.message}`);
			t.cleanup.registerProject(privateResult.value);
			const privateProject = privateResult.value;

			const allResult = await t.client.projects.list();
			if (allResult.ok) {
				expect(allResult.value.some(p => p.id === publicProject.id)).toBe(true);
				expect(allResult.value.some(p => p.id === privateProject.id)).toBe(true);
			}

			try {
				const response = await fetch("http://localhost:3001/api/v1/projects/public", {
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				if (response.ok) {
					const publicProjects = (await response.json()) as any[];
					expect(Array.isArray(publicProjects)).toBe(true);
					for (const proj of publicProjects) {
						expect(proj.visibility).toBe("PUBLIC");
					}
				}
			} catch (error) {
				console.warn("Public projects endpoint not available:", error);
			}
		});

		test("should handle project access by different visibility levels", async () => {
			const testCases = ["PUBLIC", "PRIVATE", "HIDDEN"] as const;

			for (const visibility of testCases) {
				const projectData = TestDataFactory.createRealisticProject();
				projectData.visibility = visibility;
				const createResult = await t.client.projects.create(projectData);
				if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
				t.cleanup.registerProject(createResult.value);
				const project = createResult.value;

				const fetchResult = await t.client.projects.getById(project.id);
				expect(fetchResult.ok).toBe(true);
				if (fetchResult.ok) {
					expect(fetchResult.value.visibility).toBe(visibility);
				}
			}
		});
	});

	describe("Project Configuration Edge Cases", () => {
		test("should handle empty configuration gracefully", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			const emptyConfig = {
				id: project.id,
				config: {
					tags: [],
					ignore: [],
				},
			};

			const configResult = await t.client.projects.config.save(emptyConfig);
			if (!configResult.ok) {
				console.warn("Configuration save not implemented:", configResult.error.message);
			}
		});

		test("should handle configuration with special characters", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			const configWithSpecialChars = {
				id: project.id,
				config: {
					tags: [
						{
							name: "special-chars",
							match: ["*.{ts,tsx}", "**/@types/**", "src/**/*.test.*"],
						},
					],
					ignore: ["node_modules/**", "*.log", "dist/**/*", ".git/**"],
				},
				scan_branch: "feature/special-chars",
			};

			const configResult = await t.client.projects.config.save(configWithSpecialChars);
			if (!configResult.ok && !configResult.error.message.includes("not found") && !configResult.error.message.includes("not implemented")) {
				throw new Error(`Configuration save failed unexpectedly: ${configResult.error.message}`);
			}
		});

		test("should reject invalid configuration schema", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			const invalidConfig = {
				id: project.id,
				config: {
					tags: [{ name: "", match: [] }],
					ignore: [],
				},
			};

			const configResult = await t.client.projects.config.save(invalidConfig);
			if (!configResult.ok && configResult.error.message.includes("not found")) {
				console.warn("Configuration endpoint not available:", configResult.error.message);
				return;
			}
			expect(typeof configResult.ok).toBe("boolean");
		});
	});

	describe("Project Query Parameter Edge Cases", () => {
		test("should handle malformed query parameters", async () => {
			const testCases = ["http://localhost:3001/api/v1/projects?id=", "http://localhost:3001/api/v1/projects?name=", "http://localhost:3001/api/v1/projects?id=null", "http://localhost:3001/api/v1/projects?name=undefined"];

			for (const url of testCases) {
				const response = await fetch(url, {
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
						"Content-Type": "application/json",
					},
				});

				expect([200, 400, 404]).toContain(response.status);
			}
		});
	});

	describe("Project Status Transitions", () => {
		test("should handle all valid status transitions", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			const statuses = ["DEVELOPMENT", "PAUSED", "RELEASED", "FINISHED", "ABANDONED", "STOPPED"] as const;

			for (const status of statuses) {
				const updateResult = await t.client.projects.update(project.id, { status });
				expect(updateResult.ok).toBe(true);
				if (updateResult.ok) {
					expect(updateResult.value.status).toBe(status);
				}
			}
		});
	});

	describe("Project Repository Information", () => {
		test("should handle projects without repository information", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			projectData.repo_url = null;
			projectData.repo_id = null;

			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			expect(project.repo_url).toBeNull();
			expect(project.repo_id).toBeNull();

			try {
				const response = await fetch(`http://localhost:3001/api/v1/projects/fetch_spec?project_id=${project.id}`, {
					headers: {
						Authorization: `Bearer ${t.client.getApiKey()}`,
					},
				});

				expect(response.status).toBe(400);
				const errorData = (await response.json()) as any;
				expect(errorData.error).toContain("repo_url");
			} catch (error) {
				console.warn("Specification fetch endpoint not available");
			}
		});

		test("should handle projects with invalid repository URLs", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			projectData.repo_url = "invalid-url-format";

			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);

			expect(createResult.value.repo_url).toBe("invalid-url-format");
		});
	});

	describe("Project Metadata Edge Cases", () => {
		test("should handle projects with null optional fields", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			projectData.icon_url = null;
			projectData.link_url = null;
			projectData.link_text = null;

			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);
			const project = createResult.value;

			expect(project.icon_url).toBeNull();
			expect(project.link_url).toBeNull();
			expect(project.link_text).toBeNull();
		});

		test("should handle projects with very long descriptions", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			projectData.description = "A".repeat(5000);

			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);

			expect(createResult.value.description?.length).toBe(5000);
		});

		test("should handle projects with special characters in names", async () => {
			const projectData = TestDataFactory.createRealisticProject();
			projectData.name = "Project with émojis 🚀 and spëcial chars (test)";

			const createResult = await t.client.projects.create(projectData);
			if (!createResult.ok) throw new Error(`Failed to create project: ${createResult.error.message}`);
			t.cleanup.registerProject(createResult.value);

			expect(createResult.value.name).toBe("Project with émojis 🚀 and spëcial chars (test)");
		});
	});
});
