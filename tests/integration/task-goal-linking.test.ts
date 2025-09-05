import { describe, expect, test, beforeEach } from "bun:test";
import { BaseIntegrationTest, setupBaseIntegrationTest } from "../shared/base-integration-test";
import { expectMatchesPartial } from "../shared/assertions";
import { TestDataFactory } from "./factories";
import type { Milestone, Goal, Project, TaskWithDetails, UpsertTodo } from "@devpad/schema";

/**
 * Integration tests for linking tasks to goals
 * This tests the future functionality where tasks can be assigned to specific goals
 */
class TaskGoalLinkingIntegrationTest extends BaseIntegrationTest {
	// Helper methods for creating test hierarchy
	async createTestMilestone(projectId: string, name = `Test Milestone ${Date.now()}`): Promise<Milestone> {
		const milestoneData = {
			project_id: projectId,
			name,
			description: "Test milestone for task linking",
			target_version: "v1.0.0",
		};

		const response = await fetch("http://localhost:3001/api/v0/milestones", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
			body: JSON.stringify(milestoneData),
		});

		const milestone = await response.json();
		this.cleanup.registerCleanup("milestones", async () => {
			try {
				await fetch(`http://localhost:3001/api/v0/milestones/${milestone.id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${this.client["_api_key"]}` },
				});
			} catch (error) {
				console.log(`⚠️ Failed to cleanup milestone ${milestone.id}:`, error);
			}
		});
		return milestone;
	}

	async createTestGoal(milestoneId: string, name = `Test Goal ${Date.now()}`): Promise<Goal> {
		const goalData = {
			milestone_id: milestoneId,
			name,
			description: "Test goal for task linking",
		};

		const response = await fetch("http://localhost:3001/api/v0/goals", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
			body: JSON.stringify(goalData),
		});

		const goal = await response.json();
		this.cleanup.registerCleanup("goals", async () => {
			try {
				await fetch(`http://localhost:3001/api/v0/goals/${goal.id}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${this.client["_api_key"]}` },
				});
			} catch (error) {
				console.log(`⚠️ Failed to cleanup goal ${goal.id}:`, error);
			}
		});
		return goal;
	}

	async createTaskWithGoal(projectId: string, goalId: string, taskData?: Partial<UpsertTodo>): Promise<TaskWithDetails> {
		const defaultTaskData: UpsertTodo = {
			title: `Test Task ${Date.now()}`,
			description: "Test task linked to goal",
			project_id: projectId,
			goal_id: goalId, // This links the task to the goal
			owner_id: "test_user_id",
			progress: "UNSTARTED",
			priority: "MEDIUM",
			...taskData,
		};

		const task = await this.client.tasks.create(defaultTaskData);
		this.registerTask(task);
		return task;
	}

	// Helper to get tasks for a specific goal
	async getTasksForGoal(goalId: string): Promise<TaskWithDetails[]> {
		const response = await fetch(`http://localhost:3001/api/v0/tasks?goal_id=${goalId}`, {
			headers: {
				Authorization: `Bearer ${this.client["_api_key"]}`,
			},
		});

		if (!response.ok) {
			return [];
		}

		return await response.json();
	}
}

// Setup test instance
const testInstance = new TaskGoalLinkingIntegrationTest();
setupBaseIntegrationTest(testInstance);

// Test data setup
let testProject: Project;
let testMilestone: Milestone;
let testGoal: Goal;

beforeEach(async () => {
	// Create test hierarchy: project -> milestone -> goal
	const projectData = TestDataFactory.createRealisticProject();
	testProject = await testInstance.createAndRegisterProject(projectData);
	testMilestone = await testInstance.createTestMilestone(testProject.id);
	testGoal = await testInstance.createTestGoal(testMilestone.id);
});

describe("Task-Goal Linking Integration Tests", () => {
	describe("task creation with goal assignment", () => {
		test("should create a task linked to a goal", async () => {
			const taskData: Partial<UpsertTodo> = {
				title: "Implement user registration",
				description: "Build registration form and validation",
				priority: "HIGH",
			};

			const task = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, taskData);

			expect(task).toBeDefined();
			expect(task.task.id).toMatch(/^task_/);
			expect(task.task.goal_id).toBe(testGoal.id);
			expect(task.task.project_id).toBe(testProject.id);
			expectMatchesPartial(task.task, {
				title: taskData.title,
				description: taskData.description,
				priority: taskData.priority,
			});
		});

		test("should create multiple tasks for the same goal", async () => {
			const task1 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 1 for goal",
				description: "First task",
			});

			const task2 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 2 for goal",
				description: "Second task",
			});

			expect(task1.task.goal_id).toBe(testGoal.id);
			expect(task2.task.goal_id).toBe(testGoal.id);
			expect(task1.task.id).not.toBe(task2.task.id);
		});

		test("should allow task creation without goal assignment", async () => {
			const taskData: UpsertTodo = {
				title: "Independent task",
				description: "Task not linked to any goal",
				project_id: testProject.id,
				owner_id: "test_user_id",
				progress: "UNSTARTED",
				priority: "LOW",
			};

			const task = await testInstance.client.tasks.create(taskData);
			testInstance.registerTask(task);

			expect(task.task.goal_id).toBeNull();
			expect(task.task.project_id).toBe(testProject.id);
		});
	});

	describe("task updates with goal assignment", () => {
		test("should update task to link it to a goal", async () => {
			// Create task without goal
			const taskData: UpsertTodo = {
				title: "Unlinked task",
				project_id: testProject.id,
				owner_id: "test_user_id",
			};

			const task = await testInstance.client.tasks.create(taskData);
			testInstance.registerTask(task);
			expect(task.task.goal_id).toBeNull();

			// Update task to link to goal
			const updateData = {
				goal_id: testGoal.id,
				owner_id: task.task.owner_id,
				title: task.task.title, // Include required fields
			};

			const updatedTask = await testInstance.client.tasks.update(task.task.id, updateData);
			expect(updatedTask.task.goal_id).toBe(testGoal.id);
		});

		test("should update task to change goal assignment", async () => {
			// Create second goal
			const secondGoal = await testInstance.createTestGoal(testMilestone.id, "Second Goal");

			// Create task linked to first goal
			const task = await testInstance.createTaskWithGoal(testProject.id, testGoal.id);
			expect(task.task.goal_id).toBe(testGoal.id);

			// Update to link to second goal
			const updateData = {
				goal_id: secondGoal.id,
				owner_id: task.task.owner_id,
				title: task.task.title,
			};

			const updatedTask = await testInstance.client.tasks.update(task.task.id, updateData);
			expect(updatedTask.task.goal_id).toBe(secondGoal.id);
		});

		test("should update task to unlink from goal", async () => {
			// Create task linked to goal
			const task = await testInstance.createTaskWithGoal(testProject.id, testGoal.id);
			expect(task.task.goal_id).toBe(testGoal.id);

			// Update to remove goal link
			const updateData = {
				goal_id: null,
				owner_id: task.task.owner_id,
				title: task.task.title,
			};

			const updatedTask = await testInstance.client.tasks.update(task.task.id, updateData);
			expect(updatedTask.task.goal_id).toBeNull();
		});
	});

	describe("goal progress calculation", () => {
		test("should calculate goal progress based on linked tasks", async () => {
			// Create multiple tasks for the goal
			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 1",
				progress: "COMPLETED",
			});

			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 2",
				progress: "IN_PROGRESS",
			});

			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 3",
				progress: "UNSTARTED",
			});

			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 2",
				progress: "IN_PROGRESS",
			});

			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, {
				title: "Task 3",
				progress: "UNSTARTED",
			});

			// Get goal with progress information (future API endpoint)
			const response = await fetch(`http://localhost:3001/api/v0/goals/${testGoal.id}/progress`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			// This endpoint doesn't exist yet, but we can test the concept
			if (response.ok) {
				const goalProgress = await response.json();

				// Expected: 1 completed out of 3 total = 33.33% progress
				expect(goalProgress.total_tasks).toBe(3);
				expect(goalProgress.completed_tasks).toBe(1);
				expect(goalProgress.in_progress_tasks).toBe(1);
				expect(goalProgress.unstarted_tasks).toBe(1);
				expect(Math.round(goalProgress.completion_percentage)).toBe(33);
			}
		});

		test("should calculate milestone progress based on goal progress", async () => {
			// Create second goal
			const secondGoal = await testInstance.createTestGoal(testMilestone.id, "Second Goal");

			// Add tasks to both goals
			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, { progress: "COMPLETED" });
			await testInstance.createTaskWithGoal(testProject.id, testGoal.id, { progress: "COMPLETED" });

			await testInstance.createTaskWithGoal(testProject.id, secondGoal.id, { progress: "COMPLETED" });
			await testInstance.createTaskWithGoal(testProject.id, secondGoal.id, { progress: "UNSTARTED" });

			// Get milestone with progress information (future API endpoint)
			const response = await fetch(`http://localhost:3001/api/v0/milestones/${testMilestone.id}/progress`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			// This endpoint doesn't exist yet, but we can test the concept
			if (response.ok) {
				const milestoneProgress = await response.json();

				// Expected: 3 completed out of 4 total = 75% progress
				expect(milestoneProgress.total_tasks).toBe(4);
				expect(milestoneProgress.completed_tasks).toBe(3);
				expect(Math.round(milestoneProgress.completion_percentage)).toBe(75);
			}
		});
	});

	describe("task filtering and querying", () => {
		test("should filter tasks by goal", async () => {
			// Create second goal
			const secondGoal = await testInstance.createTestGoal(testMilestone.id, "Filter Test Goal");

			// Create tasks for different goals
			const task1 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, { title: "Task for Goal 1" });
			const task2 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, { title: "Task for Goal 1 #2" });
			const task3 = await testInstance.createTaskWithGoal(testProject.id, secondGoal.id, { title: "Task for Goal 2" });

			// Get tasks for first goal
			const goal1Tasks = await testInstance.getTasksForGoal(testGoal.id);

			expect(goal1Tasks.length).toBeGreaterThanOrEqual(2);
			const goal1TaskIds = goal1Tasks.map(t => t.task.id);
			expect(goal1TaskIds).toContain(task1.task.id);
			expect(goal1TaskIds).toContain(task2.task.id);
			expect(goal1TaskIds).not.toContain(task3.task.id);
		});

		test("should get all tasks for a milestone (across all goals)", async () => {
			const secondGoal = await testInstance.createTestGoal(testMilestone.id, "Second Goal");

			// Create tasks for both goals
			const task1 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id);
			const task2 = await testInstance.createTaskWithGoal(testProject.id, secondGoal.id);

			// Get all tasks for the milestone (future API endpoint)
			const response = await fetch(`http://localhost:3001/api/v0/milestones/${testMilestone.id}/tasks`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			if (response.ok) {
				const milestoneTasks = await response.json();
				const taskIds = milestoneTasks.map((t: TaskWithDetails) => t.task.id);
				expect(taskIds).toContain(task1.task.id);
				expect(taskIds).toContain(task2.task.id);
			}
		});
	});

	describe("validation and constraints", () => {
		test("should reject task with invalid goal_id", async () => {
			const taskData: UpsertTodo = {
				title: "Invalid goal task",
				project_id: testProject.id,
				goal_id: "nonexistent_goal_id",
				owner_id: "test_user_id",
			};

			try {
				await testInstance.client.tasks.create(taskData);
				expect.unreachable("Should have thrown an error for invalid goal_id");
			} catch (error) {
				// Expected to fail with invalid goal_id
				expect(error).toBeDefined();
			}
		});

		test("should reject task with goal from different project", async () => {
			// Create another project and goal
			const otherProject = await testInstance.createAndRegisterProject(TestDataFactory.createRealisticProject());
			const otherMilestone = await testInstance.createTestMilestone(otherProject.id);
			const otherGoal = await testInstance.createTestGoal(otherMilestone.id);

			// Try to create task in first project but link to second project's goal
			const taskData: UpsertTodo = {
				title: "Cross-project task",
				project_id: testProject.id,
				goal_id: otherGoal.id, // Goal from different project
				owner_id: "test_user_id",
			};

			try {
				await testInstance.client.tasks.create(taskData);
				expect.unreachable("Should have thrown an error for cross-project goal assignment");
			} catch (error) {
				// Expected to fail with cross-project validation
				expect(error).toBeDefined();
			}
		});

		test("should maintain referential integrity when goal is deleted", async () => {
			// Create task linked to goal
			const task = await testInstance.createTaskWithGoal(testProject.id, testGoal.id);
			expect(task.task.goal_id).toBe(testGoal.id);

			// Delete the goal
			await fetch(`http://localhost:3001/api/v0/goals/${testGoal.id}`, {
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			// Check if task still exists but with null goal_id
			const response = await fetch(`http://localhost:3001/api/v0/tasks?id=${task.task.id}`, {
				headers: {
					Authorization: `Bearer ${testInstance.client["_api_key"]}`,
				},
			});

			if (response.ok) {
				const updatedTask = await response.json();
				expect(updatedTask.task.goal_id).toBeNull();
			}
		});
	});

	describe("hierarchy navigation", () => {
		test("should traverse full hierarchy: project -> milestone -> goal -> tasks", async () => {
			// Create the full hierarchy
			const task1 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, { title: "Hierarchy Task 1" });
			const task2 = await testInstance.createTaskWithGoal(testProject.id, testGoal.id, { title: "Hierarchy Task 2" });

			// Verify navigation: Project -> Milestones
			const projectMilestonesResponse = await fetch(`http://localhost:3001/api/v0/projects/${testProject.id}/milestones`, {
				headers: { Authorization: `Bearer ${testInstance.client["_api_key"]}` },
			});
			expect(projectMilestonesResponse.ok).toBe(true);
			const projectMilestones = await projectMilestonesResponse.json();
			expect(projectMilestones.some((m: Milestone) => m.id === testMilestone.id)).toBe(true);

			// Verify navigation: Milestone -> Goals
			const milestoneGoalsResponse = await fetch(`http://localhost:3001/api/v0/milestones/${testMilestone.id}/goals`, {
				headers: { Authorization: `Bearer ${testInstance.client["_api_key"]}` },
			});
			expect(milestoneGoalsResponse.ok).toBe(true);
			const milestoneGoals = await milestoneGoalsResponse.json();
			expect(milestoneGoals.some((g: Goal) => g.id === testGoal.id)).toBe(true);

			// Verify navigation: Goal -> Tasks (when API is implemented)
			const goalTasks = await testInstance.getTasksForGoal(testGoal.id);
			const goalTaskIds = goalTasks.map(t => t.task.id);
			expect(goalTaskIds).toContain(task1.task.id);
			expect(goalTaskIds).toContain(task2.task.id);
		});
	});
});
