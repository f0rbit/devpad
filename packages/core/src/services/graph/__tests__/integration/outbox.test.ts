import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { task, task_event } from "@devpad/schema/database/schema";
import { eq } from "drizzle-orm";
import { add_link, claim, remove_link, set_parent } from "../../graph.js";
import { children_all_done, emit_event, write_with_event } from "../../outbox.js";
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

describe("emit_event — payload schema guard", () => {
	test("rejects a payload whose kind doesn't match the event kind", async () => {
		const t = await seed_task(db, owner_id);
		const result = await emit_event(db, {
			kind: "task.claimed",
			subject_id: t.id,
			project_id: null,
			actor: "api",
			// @ts-expect-error deliberately mismatched for the test
			payload: { kind: "task.created", title: "oops" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("validation");
	});

	test("rejects a payload that fails its own kind's shape", async () => {
		const t = await seed_task(db, owner_id);
		const result = await emit_event(db, {
			kind: "task.claimed",
			subject_id: t.id,
			project_id: null,
			actor: "api",
			// @ts-expect-error missing required `actor` field for task.claimed
			payload: { kind: "task.claimed" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("validation");
	});
});

describe("write_with_event — atomic state+event pairing", () => {
	test("a failing emission rolls back the paired state write (bun-sqlite path)", async () => {
		const t = await seed_task(db, owner_id, { title: "before" });

		const result = await write_with_event(
			db,
			async () => {
				await db.update(task).set({ title: "after" }).where(eq(task.id, t.id));
				return { ok: true as const, value: t.id };
			},
			() => ({
				kind: "task.claimed",
				subject_id: t.id,
				project_id: null,
				actor: "api",
				// mismatched kind/payload deliberately induces the failure mid-write
				payload: { kind: "task.updated", fields: ["title"] },
			}),
		);

		expect(result.ok).toBe(false);

		const rows = await db.select().from(task).where(eq(task.id, t.id));
		expect(rows[0]?.title).toBe("before");
		expect(await events_for(t.id)).toHaveLength(0);
	});

	test("a successful write+emit leaves exactly one matching event row", async () => {
		const t = await seed_task(db, owner_id);
		const result = await write_with_event(
			db,
			async () => ({ ok: true as const, value: t.id }),
			() => ({
				kind: "task.claimed",
				subject_id: t.id,
				project_id: null,
				actor: "api",
				payload: { kind: "task.claimed", actor: "agent-1" },
			}),
		);
		expect(result.ok).toBe(true);

		const rows = await events_for(t.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("task.claimed");
	});
});

describe("children_all_done — pure predicate", () => {
	test("true only when there is at least one child and all are COMPLETED", () => {
		expect(children_all_done([{ deleted: false, progress: "COMPLETED" }])).toBe(true);
		expect(
			children_all_done([
				{ deleted: false, progress: "COMPLETED" },
				{ deleted: false, progress: "COMPLETED" },
			]),
		).toBe(true);
	});

	test("vacuous zero (alive) children never fires", () => {
		expect(children_all_done([])).toBe(false);
		expect(children_all_done([{ deleted: true, progress: "COMPLETED" }])).toBe(false);
	});

	test("false when any alive child is incomplete", () => {
		expect(
			children_all_done([
				{ deleted: false, progress: "COMPLETED" },
				{ deleted: false, progress: "IN_PROGRESS" },
			]),
		).toBe(false);
	});
});

describe("mutation paths each write exactly one matching outbox row", () => {
	test("set_parent emits task.updated", async () => {
		const parent = await seed_task(db, owner_id);
		const child = await seed_task(db, owner_id);

		const result = await set_parent(db, { id: child.id, parent_id: parent.id, rank: "i0", base_rev: child.rev });
		expect(result.ok).toBe(true);

		const rows = await events_for(child.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("task.updated");
	});

	test("claim emits task.claimed", async () => {
		const t = await seed_task(db, owner_id);
		const result = await claim(db, { id: t.id, actor: "agent-1", base_rev: t.rev });
		expect(result.ok).toBe(true);

		const rows = await events_for(t.id);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("task.claimed");
	});

	test("add_link then remove_link each emit exactly one edge event, on the src task", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);

		const link_result = await add_link(db, { src_id: a.id, dst_id: b.id, kind: "relates_to" });
		expect(link_result.ok).toBe(true);
		if (!link_result.ok) return;

		const created_rows = await events_for(a.id);
		expect(created_rows).toHaveLength(1);
		expect(created_rows[0]?.kind).toBe("edge.created");

		const unlink_result = await remove_link(db, link_result.value.id);
		expect(unlink_result.ok).toBe(true);

		const after_remove = await events_for(a.id);
		expect(after_remove.filter((r) => r.kind === "edge.removed")).toHaveLength(1);
	});

	test("a guard failure (stale rev) emits no event at all", async () => {
		const t = await seed_task(db, owner_id);
		const other = await seed_task(db, owner_id);

		const result = await set_parent(db, { id: t.id, parent_id: other.id, rank: "i0", base_rev: t.rev + 5 });
		expect(result.ok).toBe(false);
		expect(await events_for(t.id)).toHaveLength(0);
	});
});
