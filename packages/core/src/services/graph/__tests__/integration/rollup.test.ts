import { beforeEach, describe, expect, test } from "bun:test";
import { GRAPH_DEPTH_CAP, task, task_rollup } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { and, eq } from "drizzle-orm";
import { SqlCompletionEngine } from "../../completion.js";
import { set_parent, subtree } from "../../graph.js";
import { rebuild_rollup, refresh_rollup_chain } from "../../rollup.js";
import { create_test_db, seed_task, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;
let project_id: string;
let engine: SqlCompletionEngine;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	project_id = `project_test_${crypto.randomUUID()}`;
	engine = new SqlCompletionEngine(db);
});

/** Independent oracle: brute-force via `subtree()` (a different recursive-CTE
 * implementation than rollup.ts's own aggregate queries), plus a plain
 * direct-children select. */
async function brute_force(id: string) {
	const direct_children = await db.select().from(task).where(and(eq(task.parent_id, id), eq(task.deleted, false)));
	const subtree_result = await subtree(db, id, GRAPH_DEPTH_CAP);
	const subtree_tasks = subtree_result.ok ? subtree_result.value : [];
	return {
		direct_total: direct_children.length,
		direct_done: direct_children.filter((c) => c.progress === "COMPLETED").length,
		subtree_total: subtree_tasks.length,
		subtree_done: subtree_tasks.filter((c) => c.progress === "COMPLETED").length,
	};
}

async function cached_rollup(id: string) {
	const rows = await db.select().from(task_rollup).where(eq(task_rollup.task_id, id));
	return rows[0] ?? null;
}

async function expect_matches_brute_force(id: string) {
	const expected = await brute_force(id);
	const cached = await cached_rollup(id);
	expect(cached).not.toBeNull();
	expect({
		direct_total: cached?.direct_total,
		direct_done: cached?.direct_done,
		subtree_total: cached?.subtree_total,
		subtree_done: cached?.subtree_done,
	}).toEqual(expected);
}

describe("refresh_rollup_chain — after a scripted op sequence, cache equals brute-force recount", () => {
	test("create, complete (cascading), and reparent all keep every affected ancestor's cache correct", async () => {
		const grandparent = await seed_task(db, owner_id, { project_id, completion_policy: "auto_children" });
		const parent = await seed_task(db, owner_id, {
			project_id,
			parent_id: grandparent.id,
			completion_policy: "auto_children",
		});
		const leaf_a = await seed_task(db, owner_id, { project_id, parent_id: parent.id });
		const leaf_b = await seed_task(db, owner_id, { project_id, parent_id: parent.id });

		await refresh_rollup_chain(db, parent.id);
		await refresh_rollup_chain(db, grandparent.id);
		await expect_matches_brute_force(parent.id);
		await expect_matches_brute_force(grandparent.id);

		const first_complete = await engine.complete(leaf_a.id, "user", leaf_a.rev);
		expect(first_complete.ok).toBe(true);
		await refresh_rollup_chain(db, leaf_a.parent_id);
		await expect_matches_brute_force(parent.id);
		await expect_matches_brute_force(grandparent.id);

		const second_complete = await engine.complete(leaf_b.id, "user", leaf_b.rev);
		expect(second_complete.ok).toBe(true);
		if (second_complete.ok) {
			expect(second_complete.value.bubbled.map((b) => b.task.id)).toEqual([parent.id, grandparent.id]);
		}
		await refresh_rollup_chain(db, leaf_b.parent_id);
		await expect_matches_brute_force(parent.id);
		await expect_matches_brute_force(grandparent.id);

		const other_parent = await seed_task(db, owner_id, { project_id });
		const leaf_a_rows = await db.select().from(task).where(eq(task.id, leaf_a.id));
		const move_result = await set_parent(db, {
			id: leaf_a.id,
			parent_id: other_parent.id,
			rank: "i0",
			base_rev: leaf_a_rows[0].rev,
		});
		expect(move_result.ok).toBe(true);
		await refresh_rollup_chain(db, parent.id);
		await refresh_rollup_chain(db, other_parent.id);
		await expect_matches_brute_force(parent.id);
		await expect_matches_brute_force(other_parent.id);
	});
});

describe("rebuild_rollup — converges an intentionally corrupted cache", () => {
	test("recomputes every task's rollup row for a project from scratch", async () => {
		const parent = await seed_task(db, owner_id, { project_id });
		const child_a = await seed_task(db, owner_id, { project_id, parent_id: parent.id, progress: "COMPLETED" });
		await seed_task(db, owner_id, { project_id, parent_id: parent.id });
		void child_a;

		await db.insert(task_rollup).values({ task_id: parent.id, direct_done: 99, direct_total: 99, subtree_done: 99, subtree_total: 99 });

		const rebuild_result = await rebuild_rollup(db, project_id);
		expect(rebuild_result.ok).toBe(true);

		await expect_matches_brute_force(parent.id);
		const cached = await cached_rollup(parent.id);
		expect(cached?.direct_total).toBe(2);
		expect(cached?.direct_done).toBe(1);
	});

	test("scopes to the given project only", async () => {
		const other_project_id = `project_test_${crypto.randomUUID()}`;
		const in_scope = await seed_task(db, owner_id, { project_id });
		await seed_task(db, owner_id, { project_id, parent_id: in_scope.id, progress: "COMPLETED" });
		const out_of_scope = await seed_task(db, owner_id, { project_id: other_project_id });

		await rebuild_rollup(db, project_id);

		expect(await cached_rollup(in_scope.id)).not.toBeNull();
		expect(await cached_rollup(out_of_scope.id)).toBeNull();
	});
});
