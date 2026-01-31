import { beforeEach, describe, expect, test } from "bun:test";
import type { Goal, Milestone, Project, UpsertGoal, UpsertMilestone } from "@devpad/schema";
import { expectMatchesPartial, expectValidArray } from "../shared/assertions";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

// Helper function for API error assertions
const expectValidApiError = (response: Response, expectedCodes: number[] = [400, 401, 404, 500]) => {
	expect(expectedCodes).toContain(response.status);
	expect(response.ok).toBe(false);
};

class MilestonesGoalsIntegrationTest extends BaseIntegrationTest {
	// Helper methods for milestone/goal operations
	async createTestMilestone(projectId: string, milestoneData?: Partial<UpsertMilestone>): Promise<Milestone> {
		const defaultData: UpsertMilestone = {
			project_id: projectId,
			name: `Test Milestone ${Date.now()}`,
			description: "Test milestone description",
			target_version: "v1.0.0",
			target_time: "2024-12-31",
			...milestoneData,
		};

		const response = await fetch("http://localhost:3001/api/v1/milestones", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
			body: JSON.stringify(defaultData),
		});

		if (!response.ok) {
			throw new Error(`Failed to create milestone: ${response.status}`);
		}

		const milestone = await response.json();
		// Register milestone for cleanup via the CleanupManager
		this.cleanup.registerCleanup("milestones", async () => {
			try {
				const deleteResponse = await fetch(`http://localhost:3001/api/v1/milestones/${milestone.id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${this.client["_api_key"]}` },
				});
				if (deleteResponse.ok) {
					console.log(`✅ Cleaned up milestone: ${milestone.name} (${milestone.id})`);
				}
			} catch (error) {
				console.log(`⚠️ Failed to cleanup milestone ${milestone.id}:`, error);
			}
		});
		return milestone;
	}

	async createTestGoal(milestoneId: string, goalData?: Partial<UpsertGoal>): Promise<Goal> {
		const defaultData: UpsertGoal = {
			milestone_id: milestoneId,
			name: `Test Goal ${Date.now()}`,
			description: "Test goal description",
			target_time: "2024-06-30",
			...goalData,
		};

		const response = await fetch("http://localhost:3001/api/v1/goals", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
			body: JSON.stringify(defaultData),
		});

		if (!response.ok) {
			throw new Error(`Failed to create goal: ${response.status}`);
		}

		const goal = await response.json();
		// Register goal for cleanup
		this.cleanup.registerCleanup("goals", async () => {
			try {
				const deleteResponse = await fetch(`http://localhost:3001/api/v1/goals/${goal.id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${this.client["_api_key"]}` },
				});
				if (deleteResponse.ok) {
					console.log(`✅ Cleaned up goal: ${goal.name} (${goal.id})`);
				}
			} catch (error) {
				console.log(`⚠️ Failed to cleanup goal ${goal.id}:`, error);
			}
		});
		return goal;
	}

	async deleteTestMilestone(milestoneId: string): Promise<void> {
		const response = await fetch(`http://localhost:3001/api/v1/milestones/${milestoneId}`, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to delete milestone: ${response.status}`);
		}
	}

	async deleteTestGoal(goalId: string): Promise<void> {
		const response = await fetch(`http://localhost:3001/api/v1/goals/${goalId}`, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Failed to delete goal: ${response.status}`);
		}
	}
}

// Setup test instance
const testInstance = new MilestonesGoalsIntegrationTest();
setupBaseIntegrationTest(testInstance);

describe("Milestones & Goals Integration Tests", () => {
	let testProject: Project;

	beforeEach(async () => {
		const projectData = TestDataFactory.createRealisticProject();
		testProject = await testInstance.createAndRegisterProject(projectData);
	});
	describe("milestone CRUD operations", () => {
		test("should create a new milestone", async () => {
			const milestoneData: UpsertMilestone = {
				project_id: testProject.id,
				name: "Version 1.0 Release",
				description: "Major release with core features",
				target_version: "v1.0.0",
				target_time: "2024-12-31",
			};

			const milestone = await testInstance.createTestMilestone(testProject.id, milestoneData);

			expect(milestone).toBeDefined();
			expect(milestone.id).toMatch(/^milestone_/);
			expectMatchesPartial(milestone, {
				name: milestoneData.name,
				description: milestoneData.description,
				target_version: milestoneData.target_version,
				target_time: milestoneData.target_time,
			});
			expect(milestone.created_at).toBeDefined();
			expect(milestone.updated_at).toBeDefined();
			expect(milestone.deleted).toBe(false);
		});

		test("should list milestones for authenticated user", async () => {
			// Create a couple of milestones
			await testInstance.createTestMilestone(testProject.id, { name: "Milestone 1" });
			await testInstance.createTestMilestone(testProject.id, { name: "Milestone 2" });

			const response = await fetch("http://localhost:3001/api/v1/milestones", {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.ok).toBe(true);
			const milestones = await response.json();
			expectValidArray(milestones, (milestone: Milestone) => {
				expect(milestone.id).toMatch(/^milestone_/);
				expect(milestone.name).toBeDefined();
				expect(typeof milestone.name).toBe("string");
			});
		});

		test("should get milestone by ID", async () => {
			const createdMilestone = await testInstance.createTestMilestone(testProject.id);

			const response = await fetch(`http://localhost:3001/api/v1/milestones/${createdMilestone.id}`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.ok).toBe(true);
			const milestone = await response.json();
			expect(milestone.id).toBe(createdMilestone.id);
			expect(milestone.name).toBe(createdMilestone.name);
		});

		test("should update an existing milestone", async () => {
			const createdMilestone = await testInstance.createTestMilestone(testProject.id);
			const updateData = {
				name: "Updated Milestone Name",
				description: "Updated description",
				target_version: "v2.0.0",
			};

			const updateResult = await testInstance.client.milestones.update(createdMilestone.id, updateData);
			if (!updateResult.ok) {
				throw new Error(`Failed to update milestone: ${updateResult.error.message}`);
			}

			expectMatchesPartial(updateResult.value, updateData);
			expect(updateResult.value.id).toBe(createdMilestone.id);
		});

		test("should delete a milestone", async () => {
			const createdMilestone = await testInstance.createTestMilestone(testProject.id);

			await testInstance.deleteTestMilestone(createdMilestone.id);

			// Verify milestone is deleted by trying to fetch it
			const response = await fetch(`http://localhost:3001/api/v1/milestones/${createdMilestone.id}`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.status).toBe(404);
		});

		test("should get milestones for a specific project", async () => {
			// Create milestones for our test project
			const milestone1 = await testInstance.createTestMilestone(testProject.id, { name: "Project Milestone 1" });
			const milestone2 = await testInstance.createTestMilestone(testProject.id, { name: "Project Milestone 2" });

			const response = await fetch(`http://localhost:3001/api/v1/projects/${testProject.id}/milestones`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.ok).toBe(true);
			const milestones = await response.json();
			expect(Array.isArray(milestones)).toBe(true);
			expect(milestones.length).toBeGreaterThanOrEqual(2);

			const milestoneIds = milestones.map((m: Milestone) => m.id);
			expect(milestoneIds).toContain(milestone1.id);
			expect(milestoneIds).toContain(milestone2.id);
		});
	});

	describe("goal CRUD operations", () => {
		let testMilestone: Milestone;

		beforeEach(async () => {
			testMilestone = await testInstance.createTestMilestone(testProject.id);
		});

		test("should create a new goal", async () => {
			const goalData: UpsertGoal = {
				milestone_id: testMilestone.id,
				name: "Implement user authentication",
				description: "Build login, registration, and password reset functionality",
				target_time: "2024-06-30",
			};

			const goal = await testInstance.createTestGoal(testMilestone.id, goalData);

			expect(goal).toBeDefined();
			expect(goal.id).toMatch(/^goal_/);
			expectMatchesPartial(goal, {
				milestone_id: goalData.milestone_id,
				name: goalData.name,
				description: goalData.description,
				target_time: goalData.target_time,
			});
			expect(goal.created_at).toBeDefined();
			expect(goal.updated_at).toBeDefined();
			expect(goal.deleted).toBe(false);
		});

		test("should list goals for authenticated user", async () => {
			// Create a couple of goals
			await testInstance.createTestGoal(testMilestone.id, { name: "Goal 1" });
			await testInstance.createTestGoal(testMilestone.id, { name: "Goal 2" });

			const response = await fetch("http://localhost:3001/api/v1/goals", {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.ok).toBe(true);
			const goals = await response.json();
			expectValidArray(goals, (goal: Goal) => {
				expect(goal.id).toMatch(/^goal_/);
				expect(goal.name).toBeDefined();
				expect(goal.milestone_id).toBeDefined();
				expect(typeof goal.name).toBe("string");
			});
		});

		test("should get goal by ID", async () => {
			const createdGoal = await testInstance.createTestGoal(testMilestone.id);

			const response = await fetch(`http://localhost:3001/api/v1/goals/${createdGoal.id}`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.ok).toBe(true);
			const goal = await response.json();
			expect(goal.id).toBe(createdGoal.id);
			expect(goal.name).toBe(createdGoal.name);
			expect(goal.milestone_id).toBe(testMilestone.id);
		});

		test("should update an existing goal", async () => {
			const createdGoal = await testInstance.createTestGoal(testMilestone.id);
			const updateData = {
				name: "Updated Goal Name",
				description: "Updated goal description",
				target_time: "2024-08-31",
			};

			const updateResult = await testInstance.client.goals.update(createdGoal.id, updateData);
			if (!updateResult.ok) {
				throw new Error(`Failed to update goal: ${updateResult.error.message}`);
			}

			expectMatchesPartial(updateResult.value, updateData);
			expect(updateResult.value.id).toBe(createdGoal.id);
			expect(updateResult.value.milestone_id).toBe(testMilestone.id);
		});

		test("should delete a goal", async () => {
			const createdGoal = await testInstance.createTestGoal(testMilestone.id);

			const deleteResult = await testInstance.client.goals.delete(createdGoal.id);
			if (!deleteResult.ok) {
				throw new Error(`Failed to delete goal: ${deleteResult.error.message}`);
			}

			expect(deleteResult.value.success).toBe(true);

			// Verify goal is deleted by trying to fetch it
			const fetchResult = await testInstance.client.goals.find(createdGoal.id);
			// Should return null for deleted goal
			expect(fetchResult.ok ? fetchResult.value : null).toBeNull();
		});

		test("should get goals for a specific milestone", async () => {
			// Create goals for our test milestone
			const goal1 = await testInstance.createTestGoal(testMilestone.id, { name: "Milestone Goal 1" });
			const goal2 = await testInstance.createTestGoal(testMilestone.id, { name: "Milestone Goal 2" });

			const response = await fetch(`http://localhost:3001/api/v1/milestones/${testMilestone.id}/goals`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(response.ok).toBe(true);
			const goals = await response.json();
			expect(Array.isArray(goals)).toBe(true);
			expect(goals.length).toBeGreaterThanOrEqual(2);

			const goalIds = goals.map((g: Goal) => g.id);
			expect(goalIds).toContain(goal1.id);
			expect(goalIds).toContain(goal2.id);
		});
	});

	describe("validation and error handling", () => {
		test("should reject milestone with invalid project_id", async () => {
			const invalidData = {
				project_id: "nonexistent_project",
				name: "Test Milestone",
			};

			const response = await fetch("http://localhost:3001/api/v1/milestones", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
				body: JSON.stringify(invalidData),
			});

			expectValidApiError(response, [400, 401, 404]);
		});

		test("should reject goal with invalid milestone_id", async () => {
			const invalidData = {
				milestone_id: "nonexistent_milestone",
				name: "Test Goal",
			};

			const response = await fetch("http://localhost:3001/api/v1/goals", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
				body: JSON.stringify(invalidData),
			});

			expectValidApiError(response, [400, 401, 404]);
		});

		test("should reject milestone with missing required fields", async () => {
			const invalidData = {
				project_id: testProject.id,
				// Missing required 'name' field
			};

			const response = await fetch("http://localhost:3001/api/v1/milestones", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
				body: JSON.stringify(invalidData),
			});

			expect(response.status).toBe(400);
		});

		test("should reject goal with missing required fields", async () => {
			const testMilestone = await testInstance.createTestMilestone(testProject.id);
			const invalidData = {
				milestone_id: testMilestone.id,
				// Missing required 'name' field
			};

			const response = await fetch("http://localhost:3001/api/v1/goals", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
				body: JSON.stringify(invalidData),
			});

			expect(response.status).toBe(400);
		});
	});

	describe("hierarchy relationships", () => {
		test("should maintain project -> milestone -> goal hierarchy", async () => {
			// Create the full hierarchy
			const milestone = await testInstance.createTestMilestone(testProject.id, {
				name: "Hierarchy Test Milestone",
			});

			const goal = await testInstance.createTestGoal(milestone.id, {
				name: "Hierarchy Test Goal",
			});

			// Verify relationships
			expect(milestone.project_id).toBe(testProject.id); // Milestone belongs to project
			expect(goal.milestone_id).toBe(milestone.id); // Goal belongs to milestone

			// Verify we can traverse the hierarchy
			const milestoneGoalsResponse = await fetch(`http://localhost:3001/api/v1/milestones/${milestone.id}/goals`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			expect(milestoneGoalsResponse.ok).toBe(true);
			const milestoneGoals = await milestoneGoalsResponse.json();
			expect(milestoneGoals.some((g: Goal) => g.id === goal.id)).toBe(true);
		});

		test("should delete goals when milestone is deleted", async () => {
			const milestone = await testInstance.createTestMilestone(testProject.id);
			const goal = await testInstance.createTestGoal(milestone.id);

			// Delete the milestone
			await testInstance.deleteTestMilestone(milestone.id);

			// Verify the goal is also deleted/inaccessible
			const findResult = await testInstance.client.goals.find(goal.id);

			expect(findResult.ok ? findResult.value : null).toBeNull();
			expect(findResult.ok).toBe(false);
		});
	});

	describe("Task-Goal Integration", () => {
		let testMilestone: Milestone;
		let testGoal: Goal;

		beforeEach(async () => {
			testMilestone = await testInstance.createTestMilestone(testProject.id);
			testGoal = await testInstance.createTestGoal(testMilestone.id);
		});

		test("should create task with goal relationship", async () => {
			const taskData = {
				title: `Test Task ${Date.now()}`,
				summary: "Test task with goal",
				progress: "UNSTARTED",
				visibility: "PRIVATE",
				priority: "LOW",
				owner_id: TEST_USER_ID,
				project_id: testProject.id,
				goal_id: testGoal.id,
			};

			const createResult = await testInstance.client.tasks.create(taskData);

			expect(createResult.ok).toBe(true);
			if (createResult.ok) {
				expect(createResult.value).not.toBeNull();
				expect(createResult.value.task.goal_id).toBe(testGoal.id);
				expect(createResult.value.task.project_id).toBe(testProject.id);
			}
		});

		test("should modify task goal relationship", async () => {
			// Create task without goal
			const taskData = {
				title: `Test Task ${Date.now()}`,
				owner_id: TEST_USER_ID,
				project_id: testProject.id,
			};

			const createResult = await testInstance.client.tasks.create(taskData);

			expect(createResult.ok).toBe(true);
			if (createResult.ok) {
				expect(createResult.value.task.goal_id).toBeNull();

				// Update task to add goal
				const updateResult = await testInstance.client.tasks.update(createResult.value.task.id, {
					goal_id: testGoal.id,
				});

				expect(updateResult.ok).toBe(true);
				if (updateResult.ok) {
					expect(updateResult.value.task.goal_id).toBe(testGoal.id);

					// Update task to remove goal
					const finalResult = await testInstance.client.tasks.update(updateResult.value.task.id, {
						goal_id: null,
					});

					expect(finalResult.ok).toBe(true);
					if (finalResult.ok) {
						expect(finalResult.value.task.goal_id).toBeNull();
					}
				}
			}
		});

		test("should filter tasks by goal", async () => {
			const goal2 = await testInstance.createTestGoal(testMilestone.id);

			// Create tasks with different goals
			const task1Data = {
				title: "Task 1",
				owner_id: TEST_USER_ID,
				project_id: testProject.id,
				goal_id: testGoal.id,
			};

			const task2Data = {
				title: "Task 2",
				owner_id: TEST_USER_ID,
				project_id: testProject.id,
				goal_id: testGoal.id,
			};

			const task3Data = {
				title: "Task 3",
				owner_id: TEST_USER_ID,
				project_id: testProject.id,
				goal_id: goal2.id,
			};

			const task4Data = {
				title: "Task 4",
				owner_id: TEST_USER_ID,
				project_id: testProject.id,
			};

			// Create all tasks
			const taskResults = await Promise.all([testInstance.client.tasks.create(task1Data), testInstance.client.tasks.create(task2Data), testInstance.client.tasks.create(task3Data), testInstance.client.tasks.create(task4Data)]);

			// Verify task creation was successful
			for (const result of taskResults) {
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.value).not.toBeNull();
				}
			}

			// Get all project tasks
			const listResult = await testInstance.client.tasks.list({ project_id: testProject.id });

			expect(listResult.ok).toBe(true);
			if (listResult.ok) {
				expect(listResult.value).not.toBeNull();

				// Filter by testGoal (should have 2 tasks)
				const goal1Tasks = listResult.value.filter((task: any) => task.task.goal_id === testGoal.id);
				expect(goal1Tasks.length).toBe(2);

				// Filter by goal2 (should have 1 task)
				const goal2Tasks = listResult.value.filter((task: any) => task.task.goal_id === goal2.id);
				expect(goal2Tasks.length).toBe(1);

				// Filter by no goal (should have 1 task)
				const noGoalTasks = listResult.value.filter((task: any) => task.task.goal_id === null);
				expect(noGoalTasks.length).toBe(1);
			}
		});
	});
});
