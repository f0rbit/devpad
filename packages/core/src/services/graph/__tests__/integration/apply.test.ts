import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { task } from "@devpad/schema/database/schema";
import { eq } from "drizzle-orm";
import { apply } from "../../apply.js";
import { create_test_db, seed_task, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
});

describe("apply — batch create via temp handles", () => {
	test("creates a parent-and-children subtree in one call", async () => {
		const result = await apply(
			db,
			{
				idempotency_key: "idem-1",
				ops: [
					{ op: "create", data: { owner_id, title: "Parent phase", kind: "phase" } },
					{ op: "create", data: { owner_id, title: "Child A", parent_id: "$0" } },
					{ op: "create", data: { owner_id, title: "Child B", parent_id: "$0" } },
				],
			},
			{ owner_id },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.results).toHaveLength(3);

		const parent_id = result.value.results[0]!.id;
		const rows = await db.select().from(task);
		const children = rows.filter((r) => r.parent_id === parent_id);
		expect(children).toHaveLength(2);
		expect(children.map((c) => c.title).toSorted()).toEqual(["Child A", "Child B"]);
	});
});

describe("apply — idempotency replay", () => {
	test("replaying the same idempotency_key returns the identical response without re-executing", async () => {
		const request = {
			idempotency_key: "idem-replay-1",
			ops: [{ op: "create" as const, data: { owner_id, title: "Once only" } }],
		};

		const first = await apply(db, request, { owner_id });
		expect(first.ok).toBe(true);

		const second = await apply(db, request, { owner_id });
		expect(second.ok).toBe(true);
		if (first.ok && second.ok) expect(second.value).toEqual(first.value);

		const rows = await db.select().from(task);
		const matching = rows.filter((r) => r.title === "Once only");
		expect(matching).toHaveLength(1);
	});
});

describe("apply — mid-batch guard failure", () => {
	test("leaves zero rows mutated when a later op in the batch fails its guard", async () => {
		const a = await seed_task(db, owner_id, { title: "a" });
		const b = await seed_task(db, owner_id, { title: "b" });

		const result = await apply(
			db,
			{
				idempotency_key: "idem-fail-1",
				ops: [
					{ op: "reparent", id: a.id, parent_id: b.id, base_rev: a.rev },
					// stale base_rev — this op must fail its OCC guard and abort the whole batch
					{ op: "reparent", id: b.id, parent_id: a.id, base_rev: b.rev + 99 },
				],
			},
			{ owner_id },
		);

		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "apply_op_failed") {
			expect(result.error.op_index).toBe(1);
		} else {
			throw new Error(`expected apply_op_failed, got ${JSON.stringify(result)}`);
		}

		const rows = await db.select().from(task);
		const reloaded_a = rows.find((r) => r.id === a.id)!;
		expect(reloaded_a.parent_id).toBe(null); // op 0's write was rolled back too
		expect(reloaded_a.rev).toBe(a.rev);
	});
});

describe("apply — link and claim ops", () => {
	test("link op wires a blocks edge, claim op claims a task, both by handle", async () => {
		const result = await apply(
			db,
			{
				idempotency_key: "idem-link-claim-1",
				ops: [
					{ op: "create", data: { owner_id, title: "Blocker" } },
					{ op: "create", data: { owner_id, title: "Blocked" } },
					{ op: "link", link: { src_id: "$0", dst_id: "$1", kind: "blocks" } },
					{ op: "claim", id: "$0", actor: "agent-1", base_rev: 0 },
				],
			},
			{ owner_id },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const blocker_id = result.value.results[0]!.id;
		const rows = await db.select().from(task);
		const blocker = rows.find((r) => r.id === blocker_id)!;
		expect(blocker.claimed_by).toBe("agent-1");
	});
});

describe("apply — approval-kind tasks are human-only completable (task A4.3)", () => {
	test("rejects a create op that tries to insert a pre-completed approval task, bypassing the completion engine entirely", async () => {
		const result = await apply(
			db,
			{
				idempotency_key: "idem-approval-bypass-1",
				ops: [{ op: "create", data: { owner_id, title: "Sneaky approval", kind: "approval", progress: "COMPLETED" } }],
			},
			{ owner_id },
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("apply_op_failed");
		if (result.error.kind !== "apply_op_failed") return;
		expect(result.error.error.kind).toBe("approval_channel");

		const rows = await db.select().from(task);
		expect(rows).toHaveLength(0);
	});

	test("an ordinary task created pre-completed is unaffected by the guard", async () => {
		const result = await apply(
			db,
			{
				idempotency_key: "idem-approval-bypass-2",
				ops: [{ op: "create", data: { owner_id, title: "Fine", kind: "task", progress: "COMPLETED" } }],
			},
			{ owner_id },
		);

		expect(result.ok).toBe(true);
	});

	test("rejects a complete op targeting an approval-kind task inside a batch — the same engine guard `apply`'s create-op check exists alongside, not instead of", async () => {
		const approval = await seed_task(db, owner_id, { kind: "approval" });

		const result = await apply(
			db,
			{
				idempotency_key: "idem-approval-bypass-3",
				ops: [{ op: "complete", id: approval.id, base_rev: approval.rev }],
			},
			{ owner_id },
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("apply_op_failed");
		if (result.error.kind !== "apply_op_failed") return;
		expect(result.error.error.kind).toBe("approval_channel");

		const rows = await db.select().from(task).where(eq(task.id, approval.id));
		expect(rows[0]?.progress).not.toBe("COMPLETED");
	});
});
