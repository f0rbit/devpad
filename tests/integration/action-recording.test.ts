import { describe, expect, test } from "bun:test";
import type { Goal, Milestone, Project } from "@devpad/schema";
import { setupIntegration } from "../shared/base-integration-test";
import { TestDataFactory } from "./factories";
import { TEST_USER_ID } from "./setup";

const t = setupIntegration();

describe("action recording integration", () => {
	let project: Project;
	let milestone: Milestone;
	let goal: Goal;

	test("setup: create project", async () => {
		const data = TestDataFactory.createRealisticProject(TEST_USER_ID, {
			name: "Action Recording Test",
		});
		const result = await t.client.projects.upsert({
			...data,
			owner_id: TEST_USER_ID,
		});
		if (!result.ok) throw new Error(`Failed to create project: ${result.error.message}`);
		t.cleanup.registerProject(result.value);
		project = result.value;
		expect(project.id).toBeDefined();
	});

	test("project creation records CREATE_PROJECT action", async () => {
		const result = await t.client.projects.history(project.id);
		if (!result.ok) throw new Error(`Failed to get project history: ${result.error.message}`);

		expect(Array.isArray(result.value)).toBe(true);
		expect(result.value.length).toBeGreaterThan(0);

		const create_actions = result.value.filter((a: any) => a.type === "CREATE_PROJECT");
		expect(create_actions.length).toBeGreaterThan(0);
	});

	test("project update records UPDATE_PROJECT action", async () => {
		const update_result = await t.client.projects.update(project.id, {
			description: "Updated description for action test",
		});
		if (!update_result.ok) throw new Error(`Failed to update project: ${update_result.error.message}`);

		const history_result = await t.client.projects.history(project.id);
		if (!history_result.ok) throw new Error(`Failed to get project history: ${history_result.error.message}`);

		const update_actions = history_result.value.filter((a: any) => a.type === "UPDATE_PROJECT");
		expect(update_actions.length).toBeGreaterThan(0);
	});

	test("task creation records CREATE_TASK action", async () => {
		const task_data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			project_id: project.id,
			title: "Action Recording Task",
		});
		const create_result = await t.client.tasks.create(task_data);
		if (!create_result.ok) throw new Error(`Failed to create task: ${create_result.error.message}`);
		t.cleanup.registerTask(create_result.value);

		const history_result = await t.client.tasks.history.get(create_result.value.task.id);
		if (!history_result.ok) throw new Error(`Failed to get task history: ${history_result.error.message}`);

		expect(history_result.value.length).toBeGreaterThan(0);
		const create_actions = history_result.value.filter((a: any) => a.type === "CREATE_TASK");
		expect(create_actions.length).toBeGreaterThan(0);
	});

	test("task update records UPDATE_TASK action", async () => {
		const task_data = TestDataFactory.createTask({
			owner_id: TEST_USER_ID,
			project_id: project.id,
			title: "Task To Update",
		});
		const create_result = await t.client.tasks.create(task_data);
		if (!create_result.ok) throw new Error(`Failed to create task: ${create_result.error.message}`);
		t.cleanup.registerTask(create_result.value);

		const update_result = await t.client.tasks.update(create_result.value.task.id, {
			title: "Updated Task Title",
		});
		if (!update_result.ok) throw new Error(`Failed to update task: ${update_result.error.message}`);

		const history_result = await t.client.tasks.history.get(create_result.value.task.id);
		if (!history_result.ok) throw new Error(`Failed to get task history: ${history_result.error.message}`);

		const update_actions = history_result.value.filter((a: any) => a.type === "UPDATE_TASK");
		expect(update_actions.length).toBeGreaterThan(0);
	});

	test("milestone creation records CREATE_MILESTONE in project history", async () => {
		const result = await t.client.milestones.create({
			project_id: project.id,
			name: "Action Test Milestone",
			description: "Milestone for action recording test",
		});
		if (!result.ok) throw new Error(`Failed to create milestone: ${result.error.message}`);
		milestone = result.value;
		t.cleanup.registerCleanup("milestones", async () => {
			await t.client.milestones.delete(milestone.id);
		});

		const history_result = await t.client.projects.history(project.id);
		if (!history_result.ok) throw new Error(`Failed to get project history: ${history_result.error.message}`);

		const ms_actions = history_result.value.filter((a: any) => a.type === "CREATE_MILESTONE");
		expect(ms_actions.length).toBeGreaterThan(0);
	});

	test("goal creation records CREATE_GOAL in project history", async () => {
		const result = await t.client.goals.create({
			milestone_id: milestone.id,
			name: "Action Test Goal",
			description: "Goal for action recording test",
		});
		if (!result.ok) throw new Error(`Failed to create goal: ${result.error.message}`);
		goal = result.value;
		t.cleanup.registerCleanup("goals", async () => {
			await t.client.goals.delete(goal.id);
		});

		const history_result = await t.client.projects.history(project.id);
		if (!history_result.ok) throw new Error(`Failed to get project history: ${history_result.error.message}`);

		const goal_actions = history_result.value.filter((a: any) => a.type === "CREATE_GOAL");
		expect(goal_actions.length).toBeGreaterThan(0);
	});
});
