import { describe, expect, test } from "bun:test";
import type { CompletionPolicy, Task, TaskKind } from "@devpad/schema";
import { COMPLETION_POLICIES, GRAPH_DEPTH_CAP, TASK_KINDS, task, task_rollup } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { and, eq } from "drizzle-orm";
import { apply } from "../../apply.js";
import { SqlCompletionEngine } from "../../completion.js";
import { set_parent, subtree } from "../../graph.js";
import { refresh_rollup_chain } from "../../rollup.js";
import { sweep_graph } from "../../sweeper.js";
import { create_test_db, seed_task, seed_user } from "./helpers.js";

/**
 * The property suite (task A2.5) — THE automation gate. Phase A3 (hooks)
 * must not start until this file is green: it's the honest local model of
 * D1's single-writer interleaving (architecture-decisions, "Bubbling test
 * seam") — randomized trees + randomized op orderings over a single
 * connection, since every cascade step is one conditional UPDATE atomic
 * under SQLite's serialized writer.
 *
 * Every case is seeded (`mulberry32`, hand-rolled rather than a dependency —
 * same rationale as rank.ts) so a failure's seed reproduces it exactly; each
 * `test()` catches and rethrows with the seed embedded on failure.
 */

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rng: () => number, items: readonly T[]): T {
	const row = items[Math.floor(rng() * items.length)];
	if (row === undefined) throw new Error("pick: called with an empty array");
	return row;
}

function random_int(rng: () => number, min: number, max: number): number {
	return min + Math.floor(rng() * (max - min + 1));
}

function all_permutations<T>(items: T[]): T[][] {
	if (items.length <= 1) return [items];
	const result: T[][] = [];
	for (let i = 0; i < items.length; i++) {
		const rest = [...items.slice(0, i), ...items.slice(i + 1)];
		for (const perm of all_permutations(rest)) result.push([items[i] as T, ...perm]);
	}
	return result;
}

async function run_seeded_case<T>(seed: number, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		throw new Error(`property case failed — seed=${String(seed)} (rerun with this seed to reproduce): ${message}`, {
			cause,
		});
	}
}

type TreeNode = { id: string; parent_id: string | null; depth: number };

/**
 * Every node in the property suite is created through the REAL mutation
 * path (`apply()`'s create op — the same one the worker route and every
 * other consumer goes through), never the raw `seed_task` fixture helper:
 * `seed_task` bypasses outbox/rollup wiring entirely (it's a pure DB
 * fixture, used elsewhere precisely because tests there don't want side
 * effects), which would make this suite blind to exactly the kind of
 * rollup-drift bug it exists to catch.
 */
async function create_task_via_apply(
	db: Database,
	owner_id: string,
	input: { project_id: string; parent_id?: string | null; completion_policy?: CompletionPolicy; kind?: TaskKind },
): Promise<string> {
	const result = await apply(
		db,
		{
			idempotency_key: `prop_${crypto.randomUUID()}`,
			ops: [
				{
					op: "create",
					data: {
						owner_id,
						project_id: input.project_id,
						parent_id: input.parent_id ?? null,
						completion_policy: input.completion_policy,
						kind: input.kind,
					},
				},
			],
		},
		{ owner_id },
	);
	if (!result.ok) throw new Error(`create_task_via_apply failed: ${JSON.stringify(result.error)}`);
	const created = result.value.results[0];
	if (!created) throw new Error("create_task_via_apply: no result returned");
	return created.id;
}

async function generate_random_tree(
	rng: () => number,
	db: Database,
	owner_id: string,
	project_id: string,
	max_nodes: number,
): Promise<TreeNode[]> {
	const nodes: TreeNode[] = [];
	const deleted_ids = new Set<string>();
	const root_id = await create_task_via_apply(db, owner_id, {
		project_id,
		completion_policy: pick(rng, COMPLETION_POLICIES),
		kind: pick(rng, TASK_KINDS),
	});
	nodes.push({ id: root_id, parent_id: null, depth: 0 });

	while (nodes.length < max_nodes) {
		const eligible_parents = nodes.filter((n) => n.depth < GRAPH_DEPTH_CAP - 1 && !deleted_ids.has(n.id));
		if (eligible_parents.length === 0) break;
		const parent = pick(rng, eligible_parents);
		const child_id = await create_task_via_apply(db, owner_id, {
			project_id,
			parent_id: parent.id,
			completion_policy: pick(rng, COMPLETION_POLICIES),
			kind: pick(rng, TASK_KINDS),
		});
		if (rng() < 0.1) {
			// No dedicated "delete task" mutation exists yet (v2.4 gap, tracked for
			// a later phase) — simulate one here, refreshing the rollup chain the
			// same way a real delete path would have to.
			await db.update(task).set({ deleted: true }).where(eq(task.id, child_id));
			await refresh_rollup_chain(db, parent.id);
			deleted_ids.add(child_id);
		}
		nodes.push({ id: child_id, parent_id: parent.id, depth: parent.depth + 1 });
	}
	return nodes;
}

/** Independent (re-derived, not reusing graph.ts's own guard logic) ancestor-chain walk for validating the guard's decision. */
async function ancestor_chain(db: Database, id: string): Promise<Set<string>> {
	const chain = new Set<string>();
	let cursor: string | null = id;
	while (cursor) {
		const rows = await db
			.select({ parent_id: task.parent_id, deleted: task.deleted })
			.from(task)
			.where(eq(task.id, cursor));
		if (rows.length === 0 || rows[0].deleted) break;
		cursor = rows[0].parent_id;
		if (cursor) chain.add(cursor);
	}
	return chain;
}

/**
 * "Vacuous zero-children never fires" is enforced structurally — the
 * cascade guard's SQL carries `EXISTS (... children ...)` in its own WHERE
 * clause (completion.ts's `try_cascade_parent`), so it's provably
 * impossible for the guard itself to match a childless row, and that's
 * exactly what `completion-engine.test.ts`'s "zero-children parent never
 * auto-completes" case and `outbox.test.ts`'s `children_all_done` unit
 * cases assert directly. It is NOT re-checked here as a static end-of-
 * sequence scan over final DB state: this suite's random ops legitimately
 * reparent/soft-delete a completed parent's children AFTER it completed,
 * which would make a perfectly valid historical completion look "vacuous"
 * in a snapshot — that's a real, permitted outcome of restructuring, not a
 * violation of the invariant (which is about the moment of firing).
 */

async function assert_rollup_matches_brute_force(db: Database, nodes: TreeNode[]): Promise<void> {
	for (const node of nodes) {
		// A deleted node's own rollup is never read (nothing displays a deleted
		// task's ProgressRing), and it's structurally exempt from refresh:
		// `ancestors()`/`subtree()` both stop walking at a deleted node (by
		// design — a deleted node's subtree is invisible to ITS ancestors too),
		// so nothing re-triggers a refresh of a deleted node's OWN row once
		// something changes below it. Only live nodes are asserted here.
		const current_rows = await db.select({ deleted: task.deleted }).from(task).where(eq(task.id, node.id));
		if (current_rows.length === 0 || current_rows[0].deleted) continue;

		const cached_rows = await db.select().from(task_rollup).where(eq(task_rollup.task_id, node.id));
		if (cached_rows.length === 0) continue;
		const cached = cached_rows[0];
		const direct_children = await db
			.select()
			.from(task)
			.where(and(eq(task.parent_id, node.id), eq(task.deleted, false)));
		const subtree_result = await subtree(db, node.id, GRAPH_DEPTH_CAP);
		const subtree_tasks = subtree_result.ok ? subtree_result.value : [];
		expect(cached.direct_total).toBe(direct_children.length);
		expect(cached.direct_done).toBe(direct_children.filter((c) => c.progress === "COMPLETED").length);
		expect(cached.subtree_total).toBe(subtree_tasks.length);
		expect(cached.subtree_done).toBe(subtree_tasks.filter((c) => c.progress === "COMPLETED").length);
	}
}

async function run_random_ops(
	rng: () => number,
	db: Database,
	engine: SqlCompletionEngine,
	owner_id: string,
	project_id: string,
	nodes: TreeNode[],
	num_ops: number,
): Promise<void> {
	const op_kinds = ["complete", "reopen", "reparent", "create"] as const;

	for (let i = 0; i < num_ops; i++) {
		const op = pick(rng, op_kinds);

		if (op === "complete") {
			const target = pick(rng, nodes);
			const rows = await db.select().from(task).where(eq(task.id, target.id));
			if (rows.length === 0 || rows[0].deleted || rows[0].progress === "COMPLETED") continue;
			await engine.complete(target.id, "user", rows[0].rev);
			continue;
		}

		if (op === "reopen") {
			const target = pick(rng, nodes);
			await engine.reopen(target.id, "user");
			continue;
		}

		if (op === "create") {
			const parent_candidate = pick(
				rng,
				nodes.filter((n) => n.depth < GRAPH_DEPTH_CAP - 1),
			);
			if (!parent_candidate) continue;
			const parent_rows = await db.select().from(task).where(eq(task.id, parent_candidate.id));
			if (parent_rows.length === 0 || parent_rows[0].deleted) continue;
			const child_id = await create_task_via_apply(db, owner_id, {
				project_id,
				parent_id: parent_candidate.id,
				completion_policy: pick(rng, COMPLETION_POLICIES),
			});
			nodes.push({ id: child_id, parent_id: parent_candidate.id, depth: parent_candidate.depth + 1 });
			continue;
		}

		// reparent — the cycle/depth guard-correctness check
		if (nodes.length < 2) continue;
		const moving = pick(rng, nodes);
		const target = pick(rng, nodes);
		if (moving.id === target.id) continue;
		const moving_rows = await db.select().from(task).where(eq(task.id, moving.id));
		if (moving_rows.length === 0 || moving_rows[0].deleted) continue;
		const target_rows = await db.select().from(task).where(eq(task.id, target.id));
		if (target_rows.length === 0 || target_rows[0].deleted) continue;

		const target_ancestors = await ancestor_chain(db, target.id);
		const would_cycle = target_ancestors.has(moving.id);
		const target_depth = target_ancestors.size;
		const would_exceed_depth = target_depth + 1 > GRAPH_DEPTH_CAP;
		const target_was_policy_completed = target_rows[0].completed_via === "policy";
		const moving_is_open = moving_rows[0].progress !== "COMPLETED";

		const result = await set_parent(db, {
			id: moving.id,
			parent_id: target.id,
			rank: "i0",
			base_rev: moving_rows[0].rev,
		});

		if (would_cycle || would_exceed_depth) {
			expect(result.ok).toBe(false);
			continue;
		}
		expect(result.ok).toBe(true);

		// sticky semantics: a still-open child landing under a policy-completed
		// parent marks it stale, but the parent is NEVER reopened.
		if (target_was_policy_completed && moving_is_open) {
			const target_after = await db.select().from(task).where(eq(task.id, target.id));
			expect(target_after[0]?.progress).toBe("COMPLETED");
		}
	}
}

describe("bubbling property suite — random trees, random interleavings", () => {
	test("invariants hold across 200 seeded random cases", async () => {
		const CASES = 200;
		for (let seed = 1; seed <= CASES; seed++) {
			await run_seeded_case(seed, async () => {
				const rng = mulberry32(seed * 2654435761);
				const db = create_test_db();
				const owner_id = (await seed_user(db)).id;
				const project_id = `project_test_${String(seed)}`;
				const engine = new SqlCompletionEngine(db);

				const nodes = await generate_random_tree(rng, db, owner_id, project_id, random_int(rng, 4, 12));
				await run_random_ops(rng, db, engine, owner_id, project_id, nodes, random_int(rng, 5, 12));

				await assert_rollup_matches_brute_force(db, nodes);
			});
		}
	}, 30000);
});

describe("bubbling property suite — permutation-order independence", () => {
	test("exactly one sibling's completion triggers the parent, regardless of order", async () => {
		const CASES = 30;
		for (let seed = 1; seed <= CASES; seed++) {
			await run_seeded_case(seed, async () => {
				const rng = mulberry32(seed * 40503);
				const db = create_test_db();
				const owner_id = (await seed_user(db)).id;
				const project_id = `project_test_${String(seed)}`;
				const engine = new SqlCompletionEngine(db);

				const n_children = random_int(rng, 2, 4);
				const parent = await seed_task(db, owner_id, { project_id, completion_policy: "auto_children" });
				const children: Task[] = [];
				for (let i = 0; i < n_children; i++) {
					children.push(await seed_task(db, owner_id, { project_id, parent_id: parent.id }));
				}

				const permutations = all_permutations(children.map((c) => c.id));
				const order = pick(rng, permutations);

				for (const [index, child_id] of order.entries()) {
					const rows = await db.select().from(task).where(eq(task.id, child_id));
					const complete_result = await engine.complete(child_id, "user", rows[0].rev);
					expect(complete_result.ok).toBe(true);
					if (!complete_result.ok) continue;

					const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
					const is_last = index === order.length - 1;
					if (is_last) {
						expect(parent_rows[0]?.progress).toBe("COMPLETED");
						expect(parent_rows[0]?.completed_via).toBe("policy");
						expect(complete_result.value.bubbled.map((b) => b.task.id)).toContain(parent.id);
					} else {
						expect(parent_rows[0]?.progress).not.toBe("COMPLETED");
						expect(complete_result.value.bubbled).toEqual([]);
					}
				}
			});
		}
	}, 15000);
});

describe("bubbling property suite — sweeper convergence on injected crash states", () => {
	test("an injected mid-cascade crash converges to invariant-clean in <= 2 sweeps", async () => {
		const CASES = 20;
		for (let seed = 1; seed <= CASES; seed++) {
			await run_seeded_case(seed, async () => {
				const rng = mulberry32(seed * 747796405);
				const db = create_test_db();
				const owner_id = (await seed_user(db)).id;
				const project_id = `project_test_${String(seed)}`;
				const engine = new SqlCompletionEngine(db);

				const grandparent = await seed_task(db, owner_id, { project_id, completion_policy: "auto_children" });
				const parent = await seed_task(db, owner_id, {
					project_id,
					parent_id: grandparent.id,
					completion_policy: "auto_children",
				});
				const n_leaves = random_int(rng, 1, 3);
				const leaves: Task[] = [];
				for (let i = 0; i < n_leaves; i++) {
					leaves.push(await seed_task(db, owner_id, { project_id, parent_id: parent.id }));
				}

				for (const leaf of leaves) {
					const rows = await db.select().from(task).where(eq(task.id, leaf.id));
					const complete_result = await engine.complete(leaf.id, "user", rows[0].rev);
					expect(complete_result.ok).toBe(true);
				}

				// Injected crash: revert BOTH ancestors to open, as if the cascade's
				// writes never happened, while every leaf stays COMPLETED — the
				// honest shape of a process crash between guarded UPDATEs.
				await db.update(task).set({ progress: "IN_PROGRESS", completed_via: null }).where(eq(task.id, parent.id));
				await db.update(task).set({ progress: "IN_PROGRESS", completed_via: null }).where(eq(task.id, grandparent.id));

				let sweeps = 0;
				let clean = false;
				while (sweeps < 2 && !clean) {
					const result = await sweep_graph(db);
					expect(result.ok).toBe(true);
					sweeps++;
					const rows = await db.select().from(task).where(eq(task.id, grandparent.id));
					clean = rows[0]?.progress === "COMPLETED";
				}
				expect(clean).toBe(true);
				expect(sweeps).toBeLessThanOrEqual(2);

				const parent_rows = await db.select().from(task).where(eq(task.id, parent.id));
				expect(parent_rows[0]?.progress).toBe("COMPLETED");
				expect(parent_rows[0]?.completed_via).toBe("policy");

				const idempotent_sweep = await sweep_graph(db);
				expect(idempotent_sweep.ok).toBe(true);
				if (idempotent_sweep.ok) {
					expect(idempotent_sweep.value.cascades_repaired).toBe(0);
				}
			});
		}
	}, 15000);
});
