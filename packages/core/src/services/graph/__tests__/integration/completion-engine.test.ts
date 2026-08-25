import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { task, task_event } from "@devpad/schema/database/schema";
import { eq } from "drizzle-orm";
import { SqlCompletionEngine } from "../../completion.js";
import { set_parent } from "../../graph.js";
import { create_test_db, seed_task, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;
let engine: SqlCompletionEngine;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	engine = new SqlCompletionEngine(db);
});

async function events_for(id: string) {
	return db.select().from(task_event).where(eq(task_event.subject_id, id));
}

describe("SqlCompletionEngine.complete — three-level auto chain", () => {
	test("bubbles fully with correct completed_via and events at each hop", async () => {
		const grandparent = await seed_task(db, owner_id, { completion_policy: "auto_children" });
		const parent = await seed_task(db, owner_id, { parent_id: grandparent.id, completion_policy: "auto_children" });
		const leaf = await seed_task(db, owner_id, { parent_id: parent.id });

		const result = await engine.complete(leaf.id, "user", leaf.rev);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.completed.id).toBe(leaf.id);
		expect(result.value.completed.completed_via).toBe("user");
		expect(result.value.bubbled.map((b) => b.task.id)).toEqual([parent.id, grandparent.id]);
		expect(result.value.bubbled.every((b) => b.via === "policy")).toBe(true);

		const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
		expect(parent_rows[0]?.progress).toBe("COMPLETED");
		expect(parent_rows[0]?.completed_via).toBe("policy");

		const grandparent_rows = await db.select().from(task).where(eq(task.id, grandparent.id));
		expect(grandparent_rows[0]?.progress).toBe("COMPLETED");
		expect(grandparent_rows[0]?.completed_via).toBe("policy");

		const leaf_events = (await events_for(leaf.id)).map((e) => e.kind);
		expect(leaf_events).toEqual(["task.completed"]);

		const parent_events = (await events_for(parent.id)).map((e) => e.kind);
		expect(parent_events).toEqual(["node.children_all_done", "policy.fired", "task.completed"]);

		const grandparent_events = (await events_for(grandparent.id)).map((e) => e.kind);
		expect(grandparent_events).toEqual(["node.children_all_done", "policy.fired", "task.completed"]);
	});
});

describe("SqlCompletionEngine.complete — manual policy parent", () => {
	test("emits children_all_done but the parent stays open", async () => {
		const parent = await seed_task(db, owner_id, { completion_policy: "manual" });
		const leaf = await seed_task(db, owner_id, { parent_id: parent.id });

		const result = await engine.complete(leaf.id, "user", leaf.rev);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.bubbled).toEqual([]);

		const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
		expect(parent_rows[0]?.progress).not.toBe("COMPLETED");

		const parent_events = (await events_for(parent.id)).map((e) => e.kind);
		expect(parent_events).toEqual(["node.children_all_done"]);
	});
});

describe("SqlCompletionEngine.complete — zero-children parent never auto-completes", () => {
	test("a childless auto_children task is unaffected by an unrelated completion", async () => {
		const lonely = await seed_task(db, owner_id, { completion_policy: "auto_children" });
		const unrelated_parent = await seed_task(db, owner_id, { completion_policy: "auto_children" });
		const unrelated_leaf = await seed_task(db, owner_id, { parent_id: unrelated_parent.id });

		const result = await engine.complete(unrelated_leaf.id, "user", unrelated_leaf.rev);
		expect(result.ok).toBe(true);

		const lonely_rows = await db.select().from(task).where(eq(task.id, lonely.id));
		expect(lonely_rows[0]?.progress).not.toBe("COMPLETED");
		expect(await events_for(lonely.id)).toHaveLength(0);
	});

	test("rejects completing an already-completed task (idempotent guard, not silent success)", async () => {
		const leaf = await seed_task(db, owner_id, { progress: "COMPLETED", completed_via: "user" });

		const result = await engine.complete(leaf.id, "user", leaf.rev);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("graph_conflict");
	});
});

describe("SqlCompletionEngine.reopen — policy-only guard", () => {
	test("rejects reopening a user-completed task", async () => {
		const leaf = await seed_task(db, owner_id, { progress: "COMPLETED", completed_via: "user" });

		const result = await engine.reopen(leaf.id, "user");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("reopen_rejected");

		const rows = await db.select().from(task).where(eq(task.id, leaf.id));
		expect(rows[0]?.progress).toBe("COMPLETED");
	});

	test("reopens a policy-completed task and emits task.reopened", async () => {
		const parent = await seed_task(db, owner_id, { completion_policy: "auto_children" });
		const leaf = await seed_task(db, owner_id, { parent_id: parent.id });

		const complete_result = await engine.complete(leaf.id, "user", leaf.rev);
		expect(complete_result.ok).toBe(true);

		const reopen_result = await engine.reopen(parent.id, "user");
		expect(reopen_result.ok).toBe(true);
		if (!reopen_result.ok) return;
		expect(reopen_result.value.reopened.progress).toBe("IN_PROGRESS");
		expect(reopen_result.value.reopened.completed_via).toBeNull();

		const parent_events = (await events_for(parent.id)).map((e) => e.kind);
		expect(parent_events.at(-1)).toBe("task.reopened");
	});
});

describe("sticky completion — new open child under a policy-completed parent", () => {
	test("set_parent reparenting a new open child under a policy-completed parent emits node.completion_stale and never reopens the parent", async () => {
		const parent = await seed_task(db, owner_id, { completion_policy: "auto_children" });
		const leaf = await seed_task(db, owner_id, { parent_id: parent.id });

		const complete_result = await engine.complete(leaf.id, "user", leaf.rev);
		expect(complete_result.ok).toBe(true);

		const new_child = await seed_task(db, owner_id);
		const reparent_result = await set_parent(db, {
			id: new_child.id,
			parent_id: parent.id,
			rank: "i0",
			base_rev: new_child.rev,
		});
		expect(reparent_result.ok).toBe(true);

		const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
		expect(parent_rows[0]?.progress).toBe("COMPLETED");

		const parent_events = (await events_for(parent.id)).map((e) => e.kind);
		expect(parent_events.at(-1)).toBe("node.completion_stale");
	});
});

describe("SqlCompletionEngine.complete — approval-kind tasks are human-only completable (task A4.3)", () => {
	test("rejects an api-channel completion attempt with approval_channel, never completing the task", async () => {
		const approval = await seed_task(db, owner_id, { kind: "approval" });

		const result = await engine.complete(approval.id, "api", approval.rev);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("approval_channel");

		const rows = await db.select().from(task).where(eq(task.id, approval.id));
		expect(rows[0]?.progress).not.toBe("COMPLETED");
	});

	test("a user-channel completion succeeds normally", async () => {
		const approval = await seed_task(db, owner_id, { kind: "approval" });

		const result = await engine.complete(approval.id, "user", approval.rev);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.completed.progress).toBe("COMPLETED");
	});

	test("an ordinary (non-approval) task is unaffected by the guard on either channel", async () => {
		const ordinary = await seed_task(db, owner_id, { kind: "task" });

		const result = await engine.complete(ordinary.id, "api", ordinary.rev);

		expect(result.ok).toBe(true);
	});
});
