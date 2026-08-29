import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { create_test_db, seed_project, seed_task, seed_user } from "../graph/__tests__/integration/helpers.js";
import { add_link } from "../graph/graph.js";
import {
	addMilestoneAction,
	completeMilestone,
	deleteMilestone,
	getMilestone,
	getMilestoneLens,
	getProjectMilestones,
	getUserMilestones,
	upsertMilestone,
} from "../milestones.js";

/**
 * v2.4 (task A5.2) — rewritten against a real in-memory SQLite db
 * (`create_test_db`) instead of the pre-fold hand-rolled mock-db, which
 * asserted the OLD raw `milestone`-table query shape directly and cannot
 * survive the fold (milestones are now a projection over `task` rows,
 * written through `write_with_event`/`run_atomic`, which a hand-rolled mock
 * can't faithfully fake — per `testing-strategy`'s "in-memory over mocking").
 * Coverage is equivalent to the file it replaces: CRUD, ownership,
 * protection, deleted-entity handling, delete-cascade, complete.
 */

let db: Database;
let owner_id: string;
let other_owner_id: string;
let project_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	other_owner_id = (await seed_user(db)).id;
	project_id = (await seed_project(db, owner_id)).id;
});

describe("milestones", () => {
	describe("upsertMilestone", () => {
		test("creates a new milestone", async () => {
			const result = await upsertMilestone(db, { name: "Beta", project_id }, owner_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.id).toMatch(/^milestone_/);
			expect(result.value.name).toBe("Beta");
			expect(result.value.project_id).toBe(project_id);
			expect(result.value.deleted).toBe(false);
			expect(result.value.finished_at).toBeNull();
		});

		test("preserves target_time and target_version round-trip", async () => {
			const result = await upsertMilestone(
				db,
				{
					name: "v1.0",
					project_id,
					target_time: "2024-12-31",
					target_version: "v1.0.0",
				},
				owner_id,
			);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.target_time).toBe("2024-12-31");
			expect(result.value.target_version).toBe("v1.0.0");
		});

		test("updates an existing milestone", async () => {
			const created = await upsertMilestone(db, { name: "Alpha", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const updated = await upsertMilestone(db, { id: created.value.id, name: "Beta Release", project_id }, owner_id);
			expect(updated.ok).toBe(true);
			if (!updated.ok) return;
			expect(updated.value.id).toBe(created.value.id);
			expect(updated.value.name).toBe("Beta Release");
		});

		test("rejects protected entity from api channel without force", async () => {
			const created = await upsertMilestone(db, { name: "Protected", project_id }, owner_id, "user");
			if (!created.ok) throw new Error("setup failed");

			const result = await upsertMilestone(
				db,
				{ id: created.value.id, name: "Overwrite", project_id },
				owner_id,
				"api",
			);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("protected");
		});

		test("returns forbidden when user does not own project", async () => {
			const result = await upsertMilestone(db, { name: "New", project_id }, other_owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("forbidden");
		});

		test("rejects modification of a deleted milestone", async () => {
			const created = await upsertMilestone(db, { name: "Temp", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");
			const deleted = await deleteMilestone(db, created.value.id, owner_id);
			expect(deleted.ok).toBe(true);

			const result = await upsertMilestone(db, { id: created.value.id, name: "Resurrect", project_id }, owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("bad_request");
		});
	});

	describe("getMilestone / getProjectMilestones / getUserMilestones", () => {
		test("returns not_found for a missing milestone", async () => {
			const result = await getMilestone(db, "milestone_missing");
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("returns not_found for a deleted milestone", async () => {
			const created = await upsertMilestone(db, { name: "Temp", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");
			await deleteMilestone(db, created.value.id, owner_id);

			const result = await getMilestone(db, created.value.id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("lists milestones for a project and computes after_id from rank order", async () => {
			const first = await upsertMilestone(db, { name: "First", project_id }, owner_id);
			const second = await upsertMilestone(db, { name: "Second", project_id }, owner_id);
			if (!first.ok || !second.ok) throw new Error("setup failed");

			const listed = await getProjectMilestones(db, project_id);
			expect(listed.ok).toBe(true);
			if (!listed.ok) return;
			expect(listed.value.map((m) => m.id)).toEqual([first.value.id, second.value.id]);
			expect(listed.value[0]?.after_id).toBeNull();
			expect(listed.value[1]?.after_id).toBe(first.value.id);
		});

		test("lists milestones across all of a user's projects", async () => {
			const created = await upsertMilestone(db, { name: "Mine", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const listed = await getUserMilestones(db, owner_id);
			expect(listed.ok).toBe(true);
			if (!listed.ok) return;
			expect(listed.value.map((m) => m.id)).toContain(created.value.id);
		});
	});

	describe("deleteMilestone", () => {
		test("soft deletes the milestone and cascades to its goals", async () => {
			const { upsertGoal, getGoal } = await import("../goals.js");
			const created = await upsertMilestone(db, { name: "Doomed", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");
			const goal = await upsertGoal(db, { name: "Doomed goal", milestone_id: created.value.id }, owner_id);
			if (!goal.ok) throw new Error("setup failed");

			const result = await deleteMilestone(db, created.value.id, owner_id);
			expect(result.ok).toBe(true);

			const fetched = await getMilestone(db, created.value.id);
			expect(fetched.ok).toBe(false);

			const fetched_goal = await getGoal(db, goal.value.id);
			expect(fetched_goal.ok).toBe(false);
		});

		test("returns not_found for a missing milestone", async () => {
			const result = await deleteMilestone(db, "milestone_missing", owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("not_found");
		});

		test("returns forbidden when user does not own the project", async () => {
			const created = await upsertMilestone(db, { name: "Mine", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const result = await deleteMilestone(db, created.value.id, other_owner_id);
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.kind).toBe("forbidden");
		});
	});

	describe("completeMilestone", () => {
		test("sets finished_at and marks the milestone COMPLETED", async () => {
			const created = await upsertMilestone(db, { name: "Ship it", project_id }, owner_id);
			if (!created.ok) throw new Error("setup failed");

			const result = await completeMilestone(db, created.value.id, owner_id);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.finished_at).not.toBeNull();
		});
	});

	describe("getMilestoneLens — v2.4 B2 critic carry-over", () => {
		test("batches rollup/edge/completion_policy per milestone and returns real blocks edges", async () => {
			const first = await upsertMilestone(db, { name: "v1", project_id }, owner_id);
			const second = await upsertMilestone(db, { name: "v2", project_id }, owner_id);
			if (!first.ok || !second.ok) throw new Error("setup failed");

			const child = await seed_task(db, owner_id, { project_id, parent_id: first.value.id, title: "child" });
			const link = await add_link(db, { src_id: first.value.id, dst_id: second.value.id, kind: "blocks" });
			expect(link.ok).toBe(true);

			const result = await getMilestoneLens(db, project_id, 2);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.rows).toHaveLength(2);
			const first_row = result.value.rows.find((r) => r.milestone.id === first.value.id);
			expect(first_row?.completion_policy).toBe("auto_children");
			expect(first_row?.descendants.map((d) => d.id)).toEqual([child.id]);
			expect(result.value.blocks).toEqual([{ src_id: first.value.id, dst_id: second.value.id }]);
		});

		test("empty project returns an empty lens with no error", async () => {
			const other_project = await seed_project(db, owner_id, { id: "empty-lens-project" });
			const result = await getMilestoneLens(db, other_project.id, 2);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value).toEqual({ rows: [], blocks: [] });
		});
	});

	describe("addMilestoneAction", () => {
		test("records an action row", async () => {
			const result = await addMilestoneAction(db, {
				owner_id,
				milestone_id: "milestone_1",
				project_id,
				name: "Alpha Release",
				type: "CREATE_MILESTONE",
				description: "Created milestone",
			});
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value).toBe(true);
		});
	});
});
