import { beforeEach, describe, expect, test } from "bun:test";
import { task, task_event, task_rollup } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { SqlCompletionEngine } from "../../completion.js";
import { refresh_rollup_chain } from "../../rollup.js";
import { sweep_graph } from "../../sweeper.js";
import { create_test_db, seed_task, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
});

async function events_for(id: string) {
	return db.select().from(task_event).where(eq(task_event.subject_id, id));
}

describe("sweep_graph — cascade crash repair", () => {
	test("a constructed mid-cascade state (child COMPLETED, auto parent stale-open) is repaired in one sweep", async () => {
		const project_id = `project_test_${crypto.randomUUID()}`;
		const parent = await seed_task(db, owner_id, { project_id, completion_policy: "auto_children" });
		// Simulates a crash: the child was marked COMPLETED but the cascade
		// that should have completed `parent` never ran (no engine call here).
		await seed_task(db, owner_id, { project_id, parent_id: parent.id, progress: "COMPLETED", completed_via: "user" });

		const result = await sweep_graph(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.cascades_repaired).toBe(1);

		const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
		expect(parent_rows[0]?.progress).toBe("COMPLETED");
		expect(parent_rows[0]?.completed_via).toBe("policy");

		const parent_events = (await events_for(parent.id)).map((e) => e.kind);
		expect(parent_events).toEqual(["node.children_all_done", "policy.fired", "task.completed"]);
	});

	test("a manual-policy parent with a recently-completed child is left alone (not a crash)", async () => {
		const project_id = `project_test_${crypto.randomUUID()}`;
		const parent = await seed_task(db, owner_id, { project_id, completion_policy: "manual" });
		await seed_task(db, owner_id, { project_id, parent_id: parent.id, progress: "COMPLETED", completed_via: "user" });

		const result = await sweep_graph(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.cascades_repaired).toBe(0);

		const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
		expect(parent_rows[0]?.progress).not.toBe("COMPLETED");
		expect(await events_for(parent.id)).toHaveLength(0);
	});
});

describe("sweep_graph — rollup drift repair", () => {
	test("detects and repairs a corrupted cached rollup row", async () => {
		const project_id = `project_test_${crypto.randomUUID()}`;
		const parent = await seed_task(db, owner_id, { project_id, completion_policy: "manual" });
		await seed_task(db, owner_id, { project_id, parent_id: parent.id, progress: "COMPLETED" });
		await seed_task(db, owner_id, { project_id, parent_id: parent.id });
		await refresh_rollup_chain(db, parent.id);

		await db
			.update(task_rollup)
			.set({ direct_done: 99, direct_total: 99, subtree_done: 99, subtree_total: 99 })
			.where(eq(task_rollup.task_id, parent.id));

		const result = await sweep_graph(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.rollups_repaired).toBeGreaterThanOrEqual(1);

		const rollup_rows = await db.select().from(task_rollup).where(eq(task_rollup.task_id, parent.id));
		expect(rollup_rows[0]?.direct_total).toBe(2);
		expect(rollup_rows[0]?.direct_done).toBe(1);
	});
});

describe("sweep_graph — rank rebalance", () => {
	test("rewrites an oversized sibling set's ranks, bumping rev, and leaves a short one alone", async () => {
		const project_id = `project_test_${crypto.randomUUID()}`;
		const parent = await seed_task(db, owner_id, { project_id });
		const oversized_rank = "i".padEnd(35, "0");
		const stale = await seed_task(db, owner_id, { project_id, parent_id: parent.id, rank: oversized_rank });
		const other = await seed_task(db, owner_id, { project_id, parent_id: parent.id, rank: "i1" });

		const untouched_parent = await seed_task(db, owner_id, { project_id });
		const untouched_child = await seed_task(db, owner_id, {
			project_id,
			parent_id: untouched_parent.id,
			rank: "i0",
		});

		const result = await sweep_graph(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.siblings_rebalanced).toBe(2);

		const rebalanced_rows = await db.select().from(task).where(eq(task.parent_id, parent.id));
		for (const row of rebalanced_rows) {
			expect(row.rank.length).toBeLessThan(oversized_rank.length);
		}
		const stale_after = rebalanced_rows.find((r) => r.id === stale.id);
		expect(stale_after?.rev).toBe(stale.rev + 1);
		const other_after = rebalanced_rows.find((r) => r.id === other.id);
		expect(other_after?.rev).toBe(other.rev + 1);

		const untouched_rows = await db.select().from(task).where(eq(task.parent_id, untouched_parent.id));
		expect(untouched_rows[0]?.rank).toBe("i0");
		expect(untouched_rows[0]?.rev).toBe(untouched_child.rev);
	});
});

describe("sweep_graph — idempotent no-op on a clean tree", () => {
	test("performs zero writes when nothing is stale", async () => {
		const project_id = `project_test_${crypto.randomUUID()}`;
		const engine = new SqlCompletionEngine(db);
		const parent = await seed_task(db, owner_id, { project_id, completion_policy: "auto_children" });
		const leaf = await seed_task(db, owner_id, { project_id, parent_id: parent.id });
		const complete_result = await engine.complete(leaf.id, "user", leaf.rev);
		expect(complete_result.ok).toBe(true);

		const events_before = await db.select().from(task_event);
		const tasks_before = await db.select().from(task);

		const first_sweep = await sweep_graph(db);
		expect(first_sweep.ok).toBe(true);
		if (first_sweep.ok) {
			expect(first_sweep.value).toEqual({
				cascades_repaired: 0,
				rollups_repaired: 0,
				siblings_rebalanced: 0,
				cycle_violations: 0,
				depth_violations: 0,
			});
		}

		const second_sweep = await sweep_graph(db);
		expect(second_sweep.ok).toBe(true);

		const events_after = await db.select().from(task_event);
		const tasks_after = await db.select().from(task);
		expect(events_after).toEqual(events_before);
		expect(tasks_after).toEqual(tasks_before);
	});
});
