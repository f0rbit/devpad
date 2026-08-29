import { beforeEach, describe, expect, test } from "bun:test";
import { GRAPH_CHILDREN_CAP, GRAPH_DEPTH_CAP } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { add_link, ancestors, blocks_edges_among, claim, near, ready, set_parent, subtree } from "../../graph.js";
import { create_test_db, seed_task, seed_user } from "./helpers.js";

let db: Database;
let owner_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
});

describe("set_parent — structural guards", () => {
	test("rejects a reparent that would create a cycle, in one statement, leaving the row unchanged", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id, { parent_id: a.id });
		const c = await seed_task(db, owner_id, { parent_id: b.id });

		const result = await set_parent(db, { id: a.id, parent_id: c.id, rank: "i0", base_rev: a.rev });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("cycle_detected");

		const a_subtree = await subtree(db, a.id, GRAPH_DEPTH_CAP);
		expect(a_subtree.ok).toBe(true);
		if (a_subtree.ok) expect(a_subtree.value.map((t) => t.id).toSorted()).toEqual([b.id, c.id].toSorted());
	});

	test("subtree of a nonexistent id is empty", async () => {
		const result = await subtree(db, "task_does_not_exist", 5);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("rejects reparenting past the depth cap", async () => {
		// build a chain 0..GRAPH_DEPTH_CAP (that many levels is exactly at the cap)
		let parent_id: string | null = null;
		let chain_tail = "";
		for (let depth = 0; depth <= GRAPH_DEPTH_CAP; depth++) {
			const t = await seed_task(db, owner_id, { parent_id });
			parent_id = t.id;
			chain_tail = t.id;
		}
		const new_child = await seed_task(db, owner_id);

		const result = await set_parent(db, {
			id: new_child.id,
			parent_id: chain_tail,
			rank: "i0",
			base_rev: new_child.rev,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("depth_exceeded");
	});

	test("rejects reparenting onto a parent already at the children cap", async () => {
		const parent = await seed_task(db, owner_id);
		for (let i = 0; i < GRAPH_CHILDREN_CAP; i++) {
			await seed_task(db, owner_id, { parent_id: parent.id });
		}
		const one_more = await seed_task(db, owner_id);

		const result = await set_parent(db, { id: one_more.id, parent_id: parent.id, rank: "i0", base_rev: one_more.rev });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("children_cap_exceeded");
	});

	test("stale rev is rejected with a conflict carrying the current row", async () => {
		const t = await seed_task(db, owner_id);
		const parent = await seed_task(db, owner_id);

		const result = await set_parent(db, { id: t.id, parent_id: parent.id, rank: "i0", base_rev: t.rev + 5 });

		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "graph_conflict") {
			expect(result.error.current.id).toBe(t.id);
			expect(result.error.current.rev).toBe(t.rev);
			expect(result.error.current.parent_id).toBe(null);
		} else {
			throw new Error(`expected graph_conflict, got ${JSON.stringify(result)}`);
		}
	});

	test("a valid reparent succeeds and bumps rev", async () => {
		const t = await seed_task(db, owner_id);
		const parent = await seed_task(db, owner_id);

		const result = await set_parent(db, { id: t.id, parent_id: parent.id, rank: "i0", base_rev: t.rev });

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.parent_id).toBe(parent.id);
			expect(result.value.rev).toBe(t.rev + 1);
			expect(result.value.rank).toBe("i0");
		}
	});
});

describe("add_link — blocks-cycle guard", () => {
	test("rejects a blocks edge that would create a cycle", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);
		const first = await add_link(db, { src_id: a.id, dst_id: b.id, kind: "blocks" });
		expect(first.ok).toBe(true);

		const cyclic = await add_link(db, { src_id: b.id, dst_id: a.id, kind: "blocks" });
		expect(cyclic.ok).toBe(false);
		if (!cyclic.ok) expect(cyclic.error.kind).toBe("cycle_detected");
	});

	test("non-blocks kinds are unguarded", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);
		const forward = await add_link(db, { src_id: a.id, dst_id: b.id, kind: "relates_to" });
		const backward = await add_link(db, { src_id: b.id, dst_id: a.id, kind: "relates_to" });
		expect(forward.ok).toBe(true);
		expect(backward.ok).toBe(true);
	});
});

describe("blocks_edges_among — v2.4 B2 critic carry-over (milestone lens arrows)", () => {
	test("returns only blocks edges where BOTH ends are members of the set", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);
		const outside = await seed_task(db, owner_id);
		await add_link(db, { src_id: a.id, dst_id: b.id, kind: "blocks" });
		// blocks an outside task — must not appear once we scope to {a, b}.
		await add_link(db, { src_id: a.id, dst_id: outside.id, kind: "blocks" });
		// a non-blocks edge between a and b — must not appear either.
		const c = await seed_task(db, owner_id);
		await add_link(db, { src_id: b.id, dst_id: c.id, kind: "relates_to" });

		const result = await blocks_edges_among(db, [a.id, b.id, c.id]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual([{ src_id: a.id, dst_id: b.id }]);
	});

	test("empty id set returns no edges", async () => {
		const result = await blocks_edges_among(db, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});
});

describe("ready", () => {
	test("excludes blocked, parented-incomplete, deleted, future-start, and completed tasks", async () => {
		await seed_task(db, owner_id, { title: "eligible" });

		const blocker = await seed_task(db, owner_id, { title: "blocker", progress: "UNSTARTED" });
		const blocked = await seed_task(db, owner_id, { title: "blocked" });
		await add_link(db, { src_id: blocker.id, dst_id: blocked.id, kind: "blocks" });

		const done_blocker = await seed_task(db, owner_id, { title: "done_blocker", progress: "COMPLETED" });
		const unblocked = await seed_task(db, owner_id, { title: "unblocked" });
		await add_link(db, { src_id: done_blocker.id, dst_id: unblocked.id, kind: "blocks" });

		const parent = await seed_task(db, owner_id, { title: "parent" });
		await seed_task(db, owner_id, { title: "incomplete_child", parent_id: parent.id });

		await seed_task(db, owner_id, { title: "deleted_task", deleted: true });

		const future = new Date(Date.now() + 86_400_000).toISOString();
		await seed_task(db, owner_id, { title: "future_start", start_time: future });

		await seed_task(db, owner_id, { title: "already_done", progress: "COMPLETED" });

		const result = await ready(db, { owner_id, limit: 50 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const titles = result.value.items.map((t) => t.title).toSorted();
		expect(titles).toContain("eligible");
		expect(titles).toContain("blocker");
		expect(titles).toContain("unblocked");
		expect(titles).toContain("incomplete_child");

		// done_blocker is itself COMPLETED, so it's excluded on its own merits —
		// it only matters here as proof that a COMPLETED blocker doesn't block.
		expect(titles).not.toContain("done_blocker");
		expect(titles).not.toContain("blocked");
		expect(titles).not.toContain("parent");
		expect(titles).not.toContain("deleted_task");
		expect(titles).not.toContain("future_start");
		expect(titles).not.toContain("already_done");
	});

	test("paginates via cursor without returning duplicates or gaps", async () => {
		for (let i = 0; i < 5; i++) {
			await seed_task(db, owner_id, { id: `task_ready_page_${String(i)}` });
		}

		const page1 = await ready(db, { owner_id, limit: 2 });
		expect(page1.ok).toBe(true);
		if (!page1.ok) return;
		expect(page1.value.items.length).toBe(2);
		expect(page1.value.next_cursor).not.toBeNull();

		const page2 = await ready(db, { owner_id, limit: 10, cursor: page1.value.next_cursor ?? undefined });
		expect(page2.ok).toBe(true);
		if (!page2.ok) return;

		const seen_ids = new Set([...page1.value.items, ...page2.value.items].map((t) => t.id));
		expect(seen_ids.size).toBe(page1.value.items.length + page2.value.items.length);
	});
});

describe("claim", () => {
	test("sequential double-claim yields exactly one winner", async () => {
		const t = await seed_task(db, owner_id);

		const first = await claim(db, { id: t.id, actor: "agent-1", base_rev: t.rev });
		expect(first.ok).toBe(true);
		if (first.ok) {
			expect(first.value.claimed_by).toBe("agent-1");
			expect(first.value.progress).toBe("IN_PROGRESS");
		}

		const second = await claim(db, { id: t.id, actor: "agent-2", base_rev: t.rev });
		expect(second.ok).toBe(false);
	});
});

describe("ancestors", () => {
	test("walks up parent_id from immediate parent to root", async () => {
		const root = await seed_task(db, owner_id);
		const mid = await seed_task(db, owner_id, { parent_id: root.id });
		const leaf = await seed_task(db, owner_id, { parent_id: mid.id });

		const result = await ancestors(db, leaf.id);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.map((t) => t.id)).toEqual([mid.id, root.id]);
		}
	});
});

describe("near — BFS depth toggle (graph lens)", () => {
	test("depth=1 stops at direct links, depth=2/3 keep expanding the frontier", async () => {
		// chain: a -blocks-> b -blocks-> c -blocks-> d
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);
		const c = await seed_task(db, owner_id);
		const d = await seed_task(db, owner_id);
		await add_link(db, { src_id: a.id, dst_id: b.id, kind: "blocks" });
		await add_link(db, { src_id: b.id, dst_id: c.id, kind: "blocks" });
		await add_link(db, { src_id: c.id, dst_id: d.id, kind: "blocks" });

		const depth1 = await near(db, a.id, 1);
		expect(depth1.ok).toBe(true);
		if (depth1.ok) expect(depth1.value.tasks.map((t) => t.id).toSorted()).toEqual([a.id, b.id].toSorted());

		const depth2 = await near(db, a.id, 2);
		expect(depth2.ok).toBe(true);
		if (depth2.ok) expect(depth2.value.tasks.map((t) => t.id).toSorted()).toEqual([a.id, b.id, c.id].toSorted());

		const depth3 = await near(db, a.id, 3);
		expect(depth3.ok).toBe(true);
		if (depth3.ok) {
			expect(depth3.value.tasks.map((t) => t.id).toSorted()).toEqual([a.id, b.id, c.id, d.id].toSorted());
		}
	});

	test("a depth beyond NEAR_MAX_DEPTH is clamped, not unbounded", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);
		await add_link(db, { src_id: a.id, dst_id: b.id, kind: "blocks" });

		const uncapped = await near(db, a.id, 999);
		const capped = await near(db, a.id, 3);
		expect(uncapped.ok && capped.ok).toBe(true);
		if (uncapped.ok && capped.ok) {
			expect(uncapped.value.tasks.map((t) => t.id).toSorted()).toEqual(capped.value.tasks.map((t) => t.id).toSorted());
		}
	});

	test("default depth (no argument) matches depth=2, the outline rail's existing behavior", async () => {
		const a = await seed_task(db, owner_id);
		const b = await seed_task(db, owner_id);
		const c = await seed_task(db, owner_id);
		await add_link(db, { src_id: a.id, dst_id: b.id, kind: "blocks" });
		await add_link(db, { src_id: b.id, dst_id: c.id, kind: "blocks" });

		const default_result = await near(db, a.id);
		const explicit_depth2 = await near(db, a.id, 2);
		expect(default_result.ok && explicit_depth2.ok).toBe(true);
		if (default_result.ok && explicit_depth2.ok) {
			expect(default_result.value.tasks.map((t) => t.id).toSorted()).toEqual(
				explicit_depth2.value.tasks.map((t) => t.id).toSorted(),
			);
		}
	});
});
