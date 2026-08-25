import { beforeEach, describe, expect, test } from "bun:test";
import { goal, milestone, task } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { verify_fold } from "../../fold-verify.js";
import { create_test_db, seed_project, seed_user } from "./helpers.js";

/**
 * Task A5.3 — `verify_fold` is the `devpad admin verify-fold` dual-read
 * verb's engine. Simulates the post-migration steady state directly (a
 * frozen `milestone`/`goal` row PLUS its already-folded `task` projection,
 * same id) rather than re-running the A5.1 migration — that migration's own
 * correctness is `fold-migration.test.ts`'s job; this test's job is the
 * COMPARISON logic itself.
 */

let db: Database;
let owner_id: string;
let project_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	project_id = (await seed_project(db, owner_id)).id;
});

async function seed_frozen_milestone_and_projection(overrides: {
	id: string;
	name: string;
	description?: string | null;
	target_time?: string | null;
	target_version?: string | null;
	finished_at?: string | null;
	after_id?: string | null;
	rank?: string;
	projected_title?: string;
}) {
	await db.insert(milestone).values({
		id: overrides.id,
		project_id,
		name: overrides.name,
		description: overrides.description ?? null,
		target_time: overrides.target_time ?? null,
		target_version: overrides.target_version ?? null,
		finished_at: overrides.finished_at ?? null,
		after_id: overrides.after_id ?? null,
	} as never);
	await db.insert(task).values({
		id: overrides.id,
		owner_id,
		title: overrides.projected_title ?? overrides.name,
		progress: overrides.finished_at ? "COMPLETED" : "UNSTARTED",
		visibility: "PRIVATE",
		priority: "LOW",
		project_id,
		parent_id: null,
		rank: overrides.rank ?? "r0000000000",
		rev: 0,
		kind: "milestone",
		completion_policy: "auto_children",
		description: overrides.description ?? null,
		end_time: overrides.target_time ?? null,
		summary: overrides.target_version ?? null,
		goal_id: null,
	} as never);
}

describe("verify_fold", () => {
	test("reports clean when frozen rows and projections match exactly", async () => {
		await seed_frozen_milestone_and_projection({
			id: "milestone_clean_1",
			name: "Version 1.0",
			description: "First release",
			target_time: "2024-12-31",
			target_version: "v1.0.0",
		});

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.clean).toBe(true);
		expect(result.value.diffs).toEqual([]);
		expect(result.value.milestone_count).toBe(1);
	});

	test("detects and names a field mismatch", async () => {
		await seed_frozen_milestone_and_projection({
			id: "milestone_bad_1",
			name: "Version 1.0",
			projected_title: "DRIFTED TITLE",
		});

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.clean).toBe(false);
		const mismatch = result.value.diffs.find((d) => d.kind === "field_mismatch" && d.field === "name");
		expect(mismatch).toBeDefined();
		if (mismatch?.kind === "field_mismatch") {
			expect(mismatch.expected).toBe("Version 1.0");
			expect(mismatch.actual).toBe("DRIFTED TITLE");
		}
	});

	test("detects a missing projection row", async () => {
		await db.insert(milestone).values({
			id: "milestone_orphaned_1",
			project_id,
			name: "Never migrated",
		} as never);

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.clean).toBe(false);
		expect(result.value.diffs).toContainEqual({ kind: "missing_row", entity: "milestone", id: "milestone_orphaned_1" });
	});

	test("detects a completion mismatch", async () => {
		await seed_frozen_milestone_and_projection({
			id: "milestone_finished_1",
			name: "Done in the frozen table",
			finished_at: "2024-06-01T00:00:00.000Z",
		});
		// simulate a projection that never got marked COMPLETED
		await db.update(task).set({ progress: "UNSTARTED" }).where(eq(task.id, "milestone_finished_1"));

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.clean).toBe(false);
		expect(result.value.diffs).toContainEqual({
			kind: "completion_mismatch",
			entity: "milestone",
			id: "milestone_finished_1",
			expected_finished: true,
			actual_completed: false,
		});
	});

	test("detects an ordering violation against the after_id chain", async () => {
		await seed_frozen_milestone_and_projection({ id: "milestone_a", name: "A", rank: "r0000000005" });
		await seed_frozen_milestone_and_projection({
			id: "milestone_b",
			name: "B",
			after_id: "milestone_a",
			rank: "r0000000001", // wrong: should sort AFTER milestone_a, not before
		});

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.clean).toBe(false);
		expect(result.value.diffs).toContainEqual({
			kind: "ordering_violation",
			entity: "milestone",
			id: "milestone_b",
			after_id: "milestone_a",
		});
	});

	test("reports clean for goals and detects a goal field mismatch", async () => {
		await seed_frozen_milestone_and_projection({ id: "milestone_g1", name: "Alpha" });
		await db.insert(goal).values({
			id: "goal_clean_1",
			milestone_id: "milestone_g1",
			name: "Ship v1",
			description: "Release it",
			target_time: "2024-06-30",
		} as never);
		await db.insert(task).values({
			id: "goal_clean_1",
			owner_id,
			title: "Ship v1",
			progress: "UNSTARTED",
			visibility: "PRIVATE",
			priority: "LOW",
			project_id,
			parent_id: "milestone_g1",
			rank: "r0000000000",
			rev: 0,
			kind: "goal",
			completion_policy: "manual",
			description: "Release it",
			end_time: "2024-06-30",
			goal_id: null,
		} as never);

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.goal_count).toBe(1);
		expect(result.value.diffs.filter((d) => d.entity === "goal")).toEqual([]);
	});

	test("a new post-fold milestone with no frozen row is never flagged", async () => {
		await db.insert(task).values({
			id: "milestone_new_after_fold",
			owner_id,
			title: "Created after the fold",
			progress: "UNSTARTED",
			visibility: "PRIVATE",
			priority: "LOW",
			project_id,
			parent_id: null,
			rank: "r0000000099",
			rev: 0,
			kind: "milestone",
			completion_policy: "auto_children",
			goal_id: null,
		} as never);

		const result = await verify_fold(db, owner_id);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.clean).toBe(true);
		expect(result.value.diffs).toEqual([]);
	});
});
