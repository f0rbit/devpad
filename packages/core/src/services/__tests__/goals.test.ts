import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { create_test_db, seed_project, seed_user } from "../graph/__tests__/integration/helpers.js";
import {
	addGoalAction,
	completeGoal,
	deleteGoal,
	getGoal,
	getMilestoneGoals,
	getUserGoals,
	upsertGoal,
} from "../goals.js";
import { upsertMilestone } from "../milestones.js";

/**
 * v2.4 (task A5.2) — rewritten against a real in-memory SQLite db, same
 * rationale as `milestones.test.ts`'s rewrite: the old hand-rolled mock-db
 * asserted the frozen `goal` table's raw query shape directly and can't
 * survive the fold (goals are now a projection over `task` rows parented
 * under their milestone's task row).
 */

let db: Database;
let owner_id: string;
let other_owner_id: string;
let project_id: string;
let milestone_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	other_owner_id = (await seed_user(db)).id;
	project_id = (await seed_project(db, owner_id)).id;
	const milestone = await upsertMilestone(db, { name: "Alpha", project_id }, owner_id);
	if (!milestone.ok) throw new Error("setup failed");
	milestone_id = milestone.value.id;
});

describe("goals", () => {
	describe("upsertGoal", () => {
		test("creates a new goal parented under its milestone", async () => {
			const result = await upsertGoal(db, { name: "Ship v1", milestone_id }, owner_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.id).toMatch(/^goal_/);
			expect(result.value.milestone_id).toBe(milestone_id);
			expect(result.value.deleted).toBe(false);
			expect(result.value.finished_at).toBeNull();
		});

		test("updates an existing goal", async () => {
			const created = await upsertGoal(db, { name: "Ship v1", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const updated = await upsertGoal(db, { id: created.value.id, name: "Ship v2", milestone_id }, owner_id);
			expect(updated.ok).toBe(true);
			if (!updated.ok) return;
			expect(updated.value.name).toBe("Ship v2");
			expect(updated.value.milestone_id).toBe(milestone_id);
		});

		test("rejects protected entity from api channel without force", async () => {
			const created = await upsertGoal(db, { name: "Protected", milestone_id }, owner_id, "user");
			if (!created.ok) throw new Error("setup failed");

			const result = await upsertGoal(db, { id: created.value.id, name: "Overwrite", milestone_id }, owner_id, "api");
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("protected");
		});

		test("returns not_found for an invalid milestone_id", async () => {
			const result = await upsertGoal(db, { name: "New", milestone_id: "milestone_missing" }, owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("returns forbidden when user does not own the project", async () => {
			const result = await upsertGoal(db, { name: "New", milestone_id }, other_owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("forbidden");
		});

		test("rejects modification of a deleted goal", async () => {
			const created = await upsertGoal(db, { name: "Temp", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");
			const deleted = await deleteGoal(db, created.value.id, owner_id);
			expect(deleted.ok).toBe(true);

			const result = await upsertGoal(db, { id: created.value.id, name: "Resurrect", milestone_id }, owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("bad_request");
		});
	});

	describe("getGoal / getMilestoneGoals / getUserGoals", () => {
		test("returns not_found for a missing goal", async () => {
			const result = await getGoal(db, "goal_missing");
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("returns not_found for a deleted goal", async () => {
			const created = await upsertGoal(db, { name: "Temp", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");
			await deleteGoal(db, created.value.id, owner_id);

			const result = await getGoal(db, created.value.id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("lists goals for a milestone", async () => {
			const goal_1 = await upsertGoal(db, { name: "Goal 1", milestone_id }, owner_id);
			const goal_2 = await upsertGoal(db, { name: "Goal 2", milestone_id }, owner_id);
			if (!goal_1.ok || !goal_2.ok) throw new Error("setup failed");

			const listed = await getMilestoneGoals(db, milestone_id);
			expect(listed.ok).toBe(true);
			if (!listed.ok) return;
			expect(listed.value.map((g) => g.id)).toContain(goal_1.value.id);
			expect(listed.value.map((g) => g.id)).toContain(goal_2.value.id);
		});

		test("lists goals across all of a user's projects", async () => {
			const created = await upsertGoal(db, { name: "Mine", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const listed = await getUserGoals(db, owner_id);
			expect(listed.ok).toBe(true);
			if (!listed.ok) return;
			expect(listed.value.map((g) => g.id)).toContain(created.value.id);
		});
	});

	describe("deleteGoal", () => {
		test("soft deletes the goal", async () => {
			const created = await upsertGoal(db, { name: "Doomed", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const result = await deleteGoal(db, created.value.id, owner_id);
			expect(result.ok).toBe(true);

			const fetched = await getGoal(db, created.value.id);
			expect(fetched.ok).toBe(false);
		});

		test("returns not_found for a missing goal", async () => {
			const result = await deleteGoal(db, "goal_missing", owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("returns forbidden when user does not own the project", async () => {
			const created = await upsertGoal(db, { name: "Mine", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const result = await deleteGoal(db, created.value.id, other_owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("forbidden");
		});
	});

	describe("completeGoal", () => {
		test("sets finished_at and marks the goal COMPLETED", async () => {
			const created = await upsertGoal(db, { name: "Ship it", milestone_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const result = await completeGoal(db, created.value.id, owner_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.finished_at).not.toBeNull();
		});
	});

	describe("addGoalAction", () => {
		test("records an action row", async () => {
			const result = await addGoalAction(db, {
				owner_id,
				goal_id: "goal_1",
				milestone_id,
				project_id,
				name: "Ship v1",
				type: "CREATE_GOAL",
				description: "Created goal",
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value).toBe(true);
		});
	});
});
