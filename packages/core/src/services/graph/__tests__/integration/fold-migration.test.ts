import { beforeEach, describe, expect, test } from "bun:test";
import { goal, milestone, task, task_rollup } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { Database as BunSqlite } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { apply_fold_migration, create_pre_fold_db, seed_project, seed_user } from "./helpers.js";

/**
 * Task A5.1 — the hand-written backfill migration
 * (`packages/schema/src/database/drizzle/0021_v24_fold_backfill.sql`).
 * Seeds a pre-fold fixture DB (everything migrated EXCEPT the fold), then
 * applies the fold migration and asserts on the resulting `task`/
 * `task_rollup` rows. This is the acceptance oracle named by the plan:
 * "seeded pre-fold fixture DB migrated through the full journal".
 */

let sqlite: BunSqlite;
let db: Database;
let owner_id: string;
let project_id: string;

beforeEach(async () => {
	const pre_fold = create_pre_fold_db();
	sqlite = pre_fold.sqlite;
	db = pre_fold.db;
	owner_id = (await seed_user(db)).id;
	project_id = (await seed_project(db, owner_id)).id;
});

async function seed_milestone(overrides: Partial<typeof milestone.$inferInsert> = {}) {
	const id = overrides.id ?? `milestone_test_${crypto.randomUUID()}`;
	await db.insert(milestone).values({
		id,
		project_id,
		name: "Test milestone",
		description: null,
		target_time: null,
		target_version: null,
		finished_at: null,
		after_id: null,
		...overrides,
	} as never);
	return id;
}

async function seed_goal(milestone_id: string, overrides: Partial<typeof goal.$inferInsert> = {}) {
	const id = overrides.id ?? `goal_test_${crypto.randomUUID()}`;
	await db.insert(goal).values({
		id,
		milestone_id,
		name: "Test goal",
		description: null,
		target_time: null,
		finished_at: null,
		...overrides,
	} as never);
	return id;
}

async function seed_legacy_task(overrides: Partial<typeof task.$inferInsert> = {}) {
	const id = overrides.id ?? `task_test_${crypto.randomUUID()}`;
	await db.insert(task).values({
		id,
		owner_id,
		title: "Test task",
		progress: "UNSTARTED",
		visibility: "PRIVATE",
		priority: "MEDIUM",
		project_id,
		parent_id: null,
		rank: "",
		rev: 0,
		kind: "task",
		completion_policy: "manual",
		goal_id: null,
		...overrides,
	} as never);
	return id;
}

describe("fold backfill migration", () => {
	test("projects each milestone 1:1 into a task row, fields preserved", async () => {
		const finished_at = new Date("2024-06-01T00:00:00.000Z").toISOString();
		const ms_id = await seed_milestone({
			name: "Version 1.0",
			description: "First release",
			target_time: "2024-12-31",
			target_version: "v1.0.0",
			finished_at,
		});

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.id, ms_id));
		expect(rows.length).toBe(1);
		const row = rows[0]!;
		expect(row.kind).toBe("milestone");
		expect(row.parent_id).toBeNull();
		expect(row.project_id).toBe(project_id);
		expect(row.title).toBe("Version 1.0");
		expect(row.description).toBe("First release");
		expect(row.end_time).toBe("2024-12-31");
		expect(row.summary).toBe("v1.0.0");
		expect(row.progress).toBe("COMPLETED");
		expect(row.completed_via).toBe("user");
		expect(row.completion_policy).toBe("auto_children");
	});

	test("provenance/protected/timestamps are copied verbatim", async () => {
		const ms_id = await seed_milestone({
			created_at: "2023-05-01T00:00:00.000Z",
			updated_at: "2023-05-02T00:00:00.000Z",
			created_by: "api",
			modified_by: "api",
			protected: true,
			deleted: false,
		});

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.id, ms_id));
		expect(rows[0]?.created_at).toBe("2023-05-01T00:00:00.000Z");
		expect(rows[0]?.updated_at).toBe("2023-05-02T00:00:00.000Z");
		expect(rows[0]?.created_by).toBe("api");
		expect(rows[0]?.modified_by).toBe("api");
		expect(rows[0]?.protected).toBe(true);
		expect(rows[0]?.deleted).toBe(false);
	});

	test("un-finished milestone folds to UNSTARTED with no completed_via", async () => {
		const ms_id = await seed_milestone({ finished_at: null });
		apply_fold_migration(sqlite);
		const rows = await db.select().from(task).where(eq(task.id, ms_id));
		expect(rows[0]?.progress).toBe("UNSTARTED");
		expect(rows[0]?.completed_via).toBeNull();
	});

	test("projects each goal 1:1 into a task row, parented under its milestone", async () => {
		const ms_id = await seed_milestone();
		const goal_id = await seed_goal(ms_id, {
			name: "Ship v1",
			description: "Release it",
			target_time: "2024-06-30",
			finished_at: null,
		});

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.id, goal_id));
		expect(rows.length).toBe(1);
		const row = rows[0]!;
		expect(row.kind).toBe("goal");
		expect(row.parent_id).toBe(ms_id);
		expect(row.project_id).toBe(project_id);
		expect(row.title).toBe("Ship v1");
		expect(row.description).toBe("Release it");
		expect(row.end_time).toBe("2024-06-30");
		expect(row.completion_policy).toBe("manual");
		expect(row.progress).toBe("UNSTARTED");
	});

	test("milestone rank preserves the after_id chain order", async () => {
		const ms_a = await seed_milestone({ name: "A", after_id: null });
		const ms_b = await seed_milestone({ name: "B", after_id: ms_a });
		const ms_c = await seed_milestone({ name: "C", after_id: ms_b });

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.project_id, project_id));
		const ordered = rows.filter((r) => r.kind === "milestone").toSorted((a, b) => (a.rank < b.rank ? -1 : 1));
		expect(ordered.map((r) => r.id)).toEqual([ms_a, ms_b, ms_c]);
	});

	test("goal rank is sequential by created_at within its milestone", async () => {
		const ms_id = await seed_milestone();
		const goal_1 = await seed_goal(ms_id, { name: "First", created_at: "2024-01-01T00:00:00.000Z" });
		const goal_2 = await seed_goal(ms_id, { name: "Second", created_at: "2024-01-02T00:00:00.000Z" });

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.parent_id, ms_id));
		const ordered = rows.toSorted((a, b) => (a.rank < b.rank ? -1 : 1));
		expect(ordered.map((r) => r.id)).toEqual([goal_1, goal_2]);
	});

	test("orphan handling: a goal whose milestone is missing is skipped, not migrated", async () => {
		const dangling_goal_id = await seed_goal("milestone_does_not_exist", { name: "Orphan goal" });

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.id, dangling_goal_id));
		expect(rows.length).toBe(0);
	});

	test("orphan handling: a task with a dangling goal_id keeps its existing parent_id untouched", async () => {
		const dangling_task_id = await seed_legacy_task({ goal_id: "goal_does_not_exist", parent_id: null });

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.id, dangling_task_id));
		expect(rows[0]?.parent_id).toBeNull();
		expect(rows[0]?.goal_id).toBe("goal_does_not_exist");
	});

	test("existing tasks with a real goal_id are reparented under the goal-kind task", async () => {
		const ms_id = await seed_milestone();
		const goal_id = await seed_goal(ms_id);
		const t1 = await seed_legacy_task({ goal_id, created_at: "2024-01-01T00:00:00.000Z" });
		const t2 = await seed_legacy_task({ goal_id, created_at: "2024-01-02T00:00:00.000Z" });

		apply_fold_migration(sqlite);

		const rows = await db.select().from(task).where(eq(task.parent_id, goal_id));
		expect(rows.length).toBe(2);
		const ordered = rows.toSorted((a, b) => (a.rank < b.rank ? -1 : 1));
		expect(ordered.map((r) => r.id)).toEqual([t1, t2]);
	});

	test("rollup rows are rebuilt for every migrated milestone and goal", async () => {
		const ms_id = await seed_milestone();
		const goal_id = await seed_goal(ms_id);
		await seed_legacy_task({ goal_id, progress: "COMPLETED" });
		await seed_legacy_task({ goal_id, progress: "UNSTARTED" });

		apply_fold_migration(sqlite);

		const goal_rollup = await db.select().from(task_rollup).where(eq(task_rollup.task_id, goal_id));
		expect(goal_rollup[0]?.direct_total).toBe(2);
		expect(goal_rollup[0]?.direct_done).toBe(1);

		const ms_rollup = await db.select().from(task_rollup).where(eq(task_rollup.task_id, ms_id));
		expect(ms_rollup[0]?.direct_total).toBe(1);
		expect(ms_rollup[0]?.subtree_total).toBe(3); // the goal + its 2 tasks
		expect(ms_rollup[0]?.subtree_done).toBe(1);
	});

	test("idempotent: re-applying the migration is a no-op (no duplicate rows, no crash)", async () => {
		const ms_id = await seed_milestone();
		const goal_id = await seed_goal(ms_id);
		await seed_legacy_task({ goal_id });

		apply_fold_migration(sqlite);
		const before = await db.select().from(task);

		apply_fold_migration(sqlite);
		const after = await db.select().from(task);

		expect(after.length).toBe(before.length);
		expect(after.find((r) => r.id === ms_id)).toEqual(before.find((r) => r.id === ms_id));
		expect(after.find((r) => r.id === goal_id)).toEqual(before.find((r) => r.id === goal_id));
	});

	test("rollback safety: the frozen milestone/goal tables are never written to", async () => {
		const ms_id = await seed_milestone({ name: "Untouched" });
		const goal_id = await seed_goal(ms_id, { name: "Untouched goal" });

		const before_ms = await db.select().from(milestone).where(eq(milestone.id, ms_id));
		const before_goal = await db.select().from(goal).where(eq(goal.id, goal_id));

		apply_fold_migration(sqlite);

		const after_ms = await db.select().from(milestone).where(eq(milestone.id, ms_id));
		const after_goal = await db.select().from(goal).where(eq(goal.id, goal_id));
		expect(after_ms).toEqual(before_ms);
		expect(after_goal).toEqual(before_goal);
	});

	test("safe on a DB with zero legacy rows", async () => {
		expect(() => apply_fold_migration(sqlite)).not.toThrow();
		const rows = await db.select().from(task);
		expect(rows.length).toBe(0);
	});
});
