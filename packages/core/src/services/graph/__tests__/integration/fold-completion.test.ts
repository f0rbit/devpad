import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { upsertGoal } from "../../../goals.js";
import { upsertMilestone } from "../../../milestones.js";
import { getTask } from "../../../tasks.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

/**
 * Task A5.2 acceptance: "New engine tests prove children_all_done fires on a
 * milestone-kind node when its last goal completes." Milestone-kind rows are
 * created with `completion_policy='auto_children'` specifically so the
 * existing `SqlCompletionEngine`/`cascade_from` cascade (task A2.2) fires
 * for the fold's milestone→goal parent/child edge with ZERO new cascade
 * logic — this is the proof that the fold reuses the graph's completion
 * engine rather than reimplementing it.
 */

let db: Database;
let owner_id: string;
let project_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	project_id = (await seed_project(db, owner_id)).id;
});

describe("fold + completion engine", () => {
	test("a milestone auto-completes when its only goal completes", async () => {
		const milestone = await upsertMilestone(db, { name: "v1.0", project_id }, owner_id);
		if (!milestone.ok) throw new Error("setup failed");
		expect(milestone.value.finished_at).toBeNull();

		const goal = await upsertGoal(db, { name: "Ship it", milestone_id: milestone.value.id }, owner_id);
		if (!goal.ok) throw new Error("setup failed");

		const { completeGoal } = await import("../../../goals.js");
		const completed_goal = await completeGoal(db, goal.value.id, owner_id);
		expect(completed_goal.ok).toBe(true);

		const milestone_row = await getTask(db, milestone.value.id);
		expect(milestone_row.ok).toBe(true);
		if (!milestone_row.ok || !milestone_row.value) return;
		expect(milestone_row.value.task.progress).toBe("COMPLETED");
		expect(milestone_row.value.task.completed_via).toBe("policy");
	});

	test("a milestone does NOT auto-complete while a sibling goal is still open", async () => {
		const milestone = await upsertMilestone(db, { name: "v1.0", project_id }, owner_id);
		if (!milestone.ok) throw new Error("setup failed");

		const { completeGoal } = await import("../../../goals.js");
		const goal_1 = await upsertGoal(db, { name: "Done goal", milestone_id: milestone.value.id }, owner_id);
		const goal_2 = await upsertGoal(db, { name: "Open goal", milestone_id: milestone.value.id }, owner_id);
		if (!goal_1.ok || !goal_2.ok) throw new Error("setup failed");

		await completeGoal(db, goal_1.value.id, owner_id);

		const milestone_row = await getTask(db, milestone.value.id);
		expect(milestone_row.ok).toBe(true);
		if (!milestone_row.ok || !milestone_row.value) return;
		expect(milestone_row.value.task.progress).not.toBe("COMPLETED");
	});

	test("a regular task under a goal completing does NOT auto-complete the goal (manual policy)", async () => {
		const { upsertTask } = await import("../../../tasks.js");
		const milestone = await upsertMilestone(db, { name: "v1.0", project_id }, owner_id);
		if (!milestone.ok) throw new Error("setup failed");
		const goal = await upsertGoal(db, { name: "Ship it", milestone_id: milestone.value.id }, owner_id);
		if (!goal.ok) throw new Error("setup failed");

		const created = await upsertTask(
			db,
			{ title: "Subtask", owner_id, project_id, goal_id: goal.value.id, progress: "COMPLETED" },
			[],
			owner_id,
		);
		expect(created.ok).toBe(true);
		if (!created.ok || !created.value) return;
		expect(created.value.task.parent_id).toBe(goal.value.id);

		const goal_row = await getTask(db, goal.value.id);
		expect(goal_row.ok).toBe(true);
		if (!goal_row.ok || !goal_row.value) return;
		expect(goal_row.value.task.progress).not.toBe("COMPLETED");
	});
});
