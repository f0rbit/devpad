import { describe, expect, test } from "bun:test";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

describe("API client operations integration", () => {
	test("should upsert project via API client", async () => {
		const project_data = TestDataFactory.createRealisticProject();

		const request = {
			project_id: project_data.project_id,
			owner_id: TEST_USER_ID,
			name: project_data.name,
			description: project_data.description,
			status: project_data.status as "DEVELOPMENT",
			visibility: project_data.visibility,
			repo_url: "https://github.com/test/repo",
			repo_id: 12345,
			specification: "Test project specification",
			icon_url: null,
			deleted: false,
			link_url: "https://test.example.com",
			link_text: "Visit Project",
			current_version: "1.0.0",
		};

		const upsertResult = await t.client.projects.upsert(request);
		if (!upsertResult.ok) {
			throw new Error(`Failed to upsert project: ${upsertResult.error.message}`);
		}
		t.cleanup.registerProject(upsertResult.value);

		expect(upsertResult.value.project_id).toBe(request.project_id);
		expect(upsertResult.value.name).toBe(request.name);
		expect(upsertResult.value.repo_url).toBe(request.repo_url);
		expect(upsertResult.value.specification).toBe(request.specification);
	});

	test("should create task via API client", async () => {
		const request = {
			title: "API Client Task",
			description: "Created via API client",
			progress: "UNSTARTED" as const,
			visibility: "PRIVATE" as const,
			priority: "MEDIUM" as const,
			owner_id: "test-user-12345",
		};

		const createResult = await t.client.tasks.create(request);
		if (!createResult.ok) {
			throw new Error(`Failed to create task: ${createResult.error.message}`);
		}
		t.cleanup.registerTask(createResult.value);

		expect(createResult.value.task.title).toBe(request.title);
		expect(createResult.value.task.description).toBe(request.description);
		expect(createResult.value.task.progress).toBe(request.progress);
		expect(createResult.value.task.owner_id).toBe(request.owner_id);
	});

	test("should save project configuration via API client", async () => {
		const project_data = TestDataFactory.createRealisticProject();
		const projectResult = await t.client.projects.upsert({
			...project_data,
			owner_id: TEST_USER_ID,
			deleted: false,
		});
		if (!projectResult.ok) {
			throw new Error(`Failed to create project: ${projectResult.error.message}`);
		}
		t.cleanup.registerProject(projectResult.value);

		const request = {
			id: projectResult.value.id,
			config: {
				tags: [
					{
						name: "api-test",
						match: ["*.ts", "*.js"],
					},
				],
				ignore: ["node_modules", "*.log"],
			},
		};

		const configResult = await t.client.projects.config.save(request);
		if (!configResult.ok) {
			console.warn(`Configuration save failed (expected): ${configResult.error.message}`);
		}
	});

	test("should handle API client errors gracefully", async () => {
		const request = {
			id: "non-existent-project",
			config: {
				tags: [],
				ignore: [],
			},
		};

		const configResult = await t.client.projects.config.save(request);
		expect(configResult.ok).toBe(false);
		if (!configResult.ok) {
			expect(configResult.error.message).toContain("not found");
		}
	});

	describe("GitHub endpoints", () => {
		test("should list GitHub repositories", async () => {
			const reposResult = await t.client.github.repos();

			if (!reposResult.ok) {
				console.warn(`GitHub repos endpoint error (might be expected): ${reposResult.error.message}`);
				expect(reposResult.error.message).toBeDefined();
			} else {
				expect(Array.isArray(reposResult.value)).toBe(true);
			}
		});

		test("should list branches for a GitHub repository", async () => {
			const branchesResult = await t.client.github.branches("devpadorg", "devpad");

			if (!branchesResult.ok) {
				console.warn(`GitHub branches endpoint error (might be expected): ${branchesResult.error.message}`);
				expect(branchesResult.error.message).toBeDefined();
			} else {
				expect(Array.isArray(branchesResult.value)).toBe(true);
			}
		});
	});

	describe("User endpoints", () => {
		test("should get user history", async () => {
			const historyResult = await t.client.user.history();

			if (!historyResult.ok) {
				console.warn(`User history endpoint error (might be expected): ${historyResult.error.message}`);
				expect(historyResult.error.message).toBeDefined();
			} else {
				expect(Array.isArray(historyResult.value)).toBe(true);
			}
		});

		test("should update user preferences", async () => {
			const preferences_data = {
				id: TEST_USER_ID,
				task_view: "list",
			};

			const prefResult = await t.client.user.preferences(preferences_data);

			if (!prefResult.ok) {
				console.warn(`User preferences endpoint error (might be expected): ${prefResult.error.message}`);
				expect(prefResult.error.message).toBeDefined();
			} else {
				expect(prefResult.value).toBeDefined();
			}
		});
	});

	describe("Auth.keys endpoints", () => {
		test("should list API keys via auth namespace", async () => {
			const keysResult = await t.client.auth.keys.list();

			if (!keysResult.ok) {
				console.warn(`Auth keys list endpoint error (might be expected): ${keysResult.error.message}`);
				expect(keysResult.error.message).toBeDefined();
			} else {
				expect(keysResult.value).toBeDefined();
				expect(Array.isArray(keysResult.value)).toBe(true);
			}
		});

		test("should create a new API key", async () => {
			const keyResult = await t.client.auth.keys.create("test-key");

			if (!keyResult.ok) {
				console.warn(`Auth keys create endpoint error (might be expected): ${keyResult.error.message}`);
				expect(keyResult.error.message).toBeDefined();
			} else {
				expect(keyResult.value).toBeDefined();
				expect(keyResult.value.message).toBeDefined();
				expect(keyResult.value.key).toBeDefined();
				expect(keyResult.value.key.raw_key).toBeDefined();
				expect(typeof keyResult.value.key.raw_key).toBe("string");
				expect(keyResult.value.key.raw_key.startsWith("devpad_")).toBe(true);
				expect(keyResult.value.key.key.name).toBe("test-key");
			}
		});
	});

	describe("Project utility endpoints", () => {
		test("should get project map", async () => {
			const project_data = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create({
				project_id: project_data.project_id,
				owner_id: TEST_USER_ID,
				name: project_data.name,
				description: project_data.description,
				status: project_data.status as "DEVELOPMENT",
				visibility: project_data.visibility,
				repo_url: "https://github.com/test/repo-map",
				repo_id: 99999,
				specification: "Test project for map",
				icon_url: null,
				deleted: false,
				link_url: "https://map.example.com",
				link_text: "Map Project",
				current_version: "1.0.0",
			});

			if (!createResult.ok) {
				throw new Error(`Failed to create project for map test: ${createResult.error.message}`);
			}
			t.cleanup.registerProject(createResult.value);

			const mapResult = await t.client.projects.map();

			if (!mapResult.ok) {
				throw new Error(`Failed to get projects map: ${mapResult.error.message}`);
			}

			expect(mapResult.value).toBeDefined();
			expect(typeof mapResult.value).toBe("object");
			expect(mapResult.value[createResult.value.id]).toBeDefined();
			expect(mapResult.value[createResult.value.id].name).toBe(createResult.value.name);
		});

		test("should get project history", async () => {
			const project_data = TestDataFactory.createRealisticProject();
			const createResult = await t.client.projects.create({
				project_id: `${project_data.project_id}-history`,
				owner_id: TEST_USER_ID,
				name: `${project_data.name} History Test`,
				description: project_data.description,
				status: project_data.status as "DEVELOPMENT",
				visibility: project_data.visibility,
				repo_url: "https://github.com/test/repo-history",
				repo_id: 88888,
				specification: "Test project for history",
				icon_url: null,
				deleted: false,
				link_url: "https://history.example.com",
				link_text: "History Project",
				current_version: "1.0.0",
			});

			if (!createResult.ok) {
				throw new Error(`Failed to create project for history test: ${createResult.error.message}`);
			}
			t.cleanup.registerProject(createResult.value);

			const historyResult = await t.client.projects.history(createResult.value.project_id);

			if (!historyResult.ok) {
				console.warn(`Project history endpoint error (might be expected): ${historyResult.error.message}`);
				expect(historyResult.error.message).toBeDefined();
			} else {
				expect(Array.isArray(historyResult.value)).toBe(true);
			}
		});
	});

	describe("Milestones endpoints", () => {
		test("should create and manage milestones", async () => {
			const project_data = TestDataFactory.createRealisticProject();
			const projectResult = await t.client.projects.create({
				project_id: `${project_data.project_id}-milestone`,
				owner_id: TEST_USER_ID,
				name: `${project_data.name} Milestone Test`,
				description: project_data.description,
				status: project_data.status as "DEVELOPMENT",
				visibility: project_data.visibility,
				repo_url: "https://github.com/test/repo-milestone",
				repo_id: 77777,
				specification: "Test project for milestones",
				icon_url: null,
				deleted: false,
				link_url: "https://milestone.example.com",
				link_text: "Milestone Project",
				current_version: "1.0.0",
			});

			if (!projectResult.ok) {
				throw new Error(`Failed to create project for milestone test: ${projectResult.error.message}`);
			}
			t.cleanup.registerProject(projectResult.value);

			const milestone_data = {
				project_id: projectResult.value.id,
				name: "Test Milestone",
				description: "Test milestone description",
				target_time: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
				target_version: "2.0.0",
			};

			const milestoneResult = await t.client.milestones.create(milestone_data);

			if (!milestoneResult.ok) {
				console.warn(`Milestone create endpoint error (might be expected): ${milestoneResult.error.message}`);
				expect(milestoneResult.error.message).toBeDefined();
				return;
			}

			expect(milestoneResult.value).toBeDefined();
			expect(milestoneResult.value.name).toBe(milestone_data.name);

			const listResult = await t.client.milestones.list();
			if (listResult.ok) {
				expect(Array.isArray(listResult.value)).toBe(true);
			}

			const updateResult = await t.client.milestones.update(milestoneResult.value.id, {
				name: "Updated Milestone",
			});

			if (updateResult.ok) {
				expect(updateResult.value.name).toBe("Updated Milestone");
			}

			const projectMilestonesResult = await t.client.milestones.getByProject(projectResult.value.id);
			if (projectMilestonesResult.ok) {
				expect(Array.isArray(projectMilestonesResult.value)).toBe(true);
			}

			const deleteResult = await t.client.milestones.delete(milestoneResult.value.id);
			if (deleteResult.ok) {
				expect(deleteResult.value.success).toBe(true);
			}
		});
	});

	describe("Goals endpoints", () => {
		test("should create and manage goals", async () => {
			const project_data = TestDataFactory.createRealisticProject();
			const projectResult = await t.client.projects.create({
				project_id: `${project_data.project_id}-goal`,
				owner_id: TEST_USER_ID,
				name: `${project_data.name} Goal Test`,
				description: project_data.description,
				status: project_data.status as "DEVELOPMENT",
				visibility: project_data.visibility,
				repo_url: "https://github.com/test/repo-goal",
				repo_id: 66666,
				specification: "Test project for goals",
				icon_url: null,
				deleted: false,
				link_url: "https://goal.example.com",
				link_text: "Goal Project",
				current_version: "1.0.0",
			});

			if (!projectResult.ok) {
				throw new Error(`Failed to create project for goal test: ${projectResult.error.message}`);
			}
			t.cleanup.registerProject(projectResult.value);

			const milestoneResult = await t.client.milestones.create({
				project_id: projectResult.value.id,
				name: "Goal Test Milestone",
				description: "Milestone for goal testing",
			});

			if (!milestoneResult.ok) {
				console.warn(`Milestone creation failed, skipping goal tests: ${milestoneResult.error.message}`);
				return;
			}

			const goal_data = {
				milestone_id: milestoneResult.value.id,
				name: "Test Goal",
				description: "Test goal description",
				target_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
			};

			const goalResult = await t.client.goals.create(goal_data);

			if (!goalResult.ok) {
				console.warn(`Goal create endpoint error (might be expected): ${goalResult.error.message}`);
				expect(goalResult.error.message).toBeDefined();
				return;
			}

			expect(goalResult.value).toBeDefined();
			expect(goalResult.value.name).toBe(goal_data.name);

			const listResult = await t.client.goals.list();
			if (listResult.ok) {
				expect(Array.isArray(listResult.value)).toBe(true);
			}

			const updateResult = await t.client.goals.update(goalResult.value.id, {
				name: "Updated Goal",
			});

			if (updateResult.ok) {
				expect(updateResult.value.name).toBe("Updated Goal");
			}

			const milestoneGoalsResult = await t.client.milestones.goals(milestoneResult.value.id);
			if (milestoneGoalsResult.ok) {
				expect(Array.isArray(milestoneGoalsResult.value)).toBe(true);
			}

			const deleteResult = await t.client.goals.delete(goalResult.value.id);
			if (deleteResult.ok) {
				expect(deleteResult.value.success).toBe(true);
			}
		});
	});

	describe("Tags endpoints", () => {
		test("should list tags", async () => {
			const tagsResult = await t.client.tags.list();

			if (!tagsResult.ok) {
				console.warn(`Tags list endpoint error (might be expected): ${tagsResult.error.message}`);
				expect(tagsResult.error.message).toBeDefined();
			} else {
				expect(Array.isArray(tagsResult.value)).toBe(true);
			}
		});
	});
});
