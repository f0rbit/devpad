import { Database as BunSqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { scanning } from "@devpad/core/services";
import type { DiffResult } from "@devpad/core/services/scanner";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { GRAPH_DEPTH_CAP, task, task_link } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { and, eq } from "drizzle-orm";

const { processScanResults } = scanning;

/**
 * Task A5.4 — scanner ⇄ graph reconciliation. Exercises `processScanResults`
 * (the accept path) directly against a real in-memory SQLite db, bypassing
 * the actual GitHub network call (`initiateScan` calls a live API and isn't
 * network-testable here) — a `todo_updates` row with a pre-built
 * `diff_results` payload (including the `proposal` a real scan would have
 * attached) is seeded directly, matching exactly what `initiateScan` would
 * have stored.
 */

let db: Database;
let owner_id: string;
let project_id: string;

async function seed_user_row(): Promise<string> {
	const id = `user_scan_${crypto.randomUUID()}`;
	const { user } = await import("@devpad/schema/database/schema");
	await db.insert(user).values({
		id,
		name: "tester",
		email: `${id}@test.example`,
		task_view: "list",
	});
	return id;
}

async function seed_project_row(owner: string): Promise<string> {
	const id = `project_scan_${crypto.randomUUID()}`;
	const { project } = await import("@devpad/schema/database/schema");
	await db.insert(project).values({
		id,
		owner_id: owner,
		project_id: id,
		name: "Scan test project",
		status: "DEVELOPMENT",
		visibility: "PRIVATE",
	});
	return id;
}

async function seed_open_task(overrides: Partial<typeof task.$inferInsert> = {}): Promise<string> {
	const id = overrides.id ?? `task_scan_${crypto.randomUUID()}`;
	await db.insert(task).values({
		id,
		owner_id,
		title: "Existing task",
		progress: "UNSTARTED",
		visibility: "PRIVATE",
		priority: "MEDIUM",
		project_id,
		parent_id: null,
		rank: "",
		rev: 0,
		kind: "task",
		completion_policy: "manual",
		...overrides,
	});
	return id;
}

async function seed_codebase_task(id: string, file: string): Promise<void> {
	const { codebase_tasks } = await import("@devpad/schema/database/schema");
	await db.insert(codebase_tasks).values({
		id,
		text: "// TODO existing",
		line: 1,
		file,
		type: "todo",
		recent_scan_id: 1,
	});
}

async function seed_pending_update(diff_results: DiffResult[]): Promise<number> {
	const { todo_updates, tracker_result } = await import("@devpad/schema/database/schema");
	const tracker = await db.insert(tracker_result).values({ project_id, data: "[]" }).returning();
	const rows = await db
		.insert(todo_updates)
		.values({
			project_id,
			new_id: tracker[0].id,
			data: JSON.stringify(diff_results),
			status: "PENDING",
		})
		.returning();
	return rows[0].id;
}

function new_diff_item(id: string, file: string, proposal?: DiffResult["proposal"]): DiffResult {
	return {
		id,
		tag: "todo",
		type: "NEW",
		data: { old: null, new: { text: "// TODO new task", line: 5, file, context: [] } },
		...(proposal !== undefined ? { proposal } : {}),
	};
}

beforeEach(async () => {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	db = createBunDatabase(sqlite);
	owner_id = await seed_user_row();
	project_id = await seed_project_row(owner_id);
});

describe("scanner reconciliation", () => {
	test("same-file match proposes the parent and draws a discovered_from edge", async () => {
		const existing_id = await seed_open_task({ title: "Existing feature task" });
		await seed_codebase_task("codebase_existing", "src/feature.ts");
		await db.update(task).set({ codebase_task_id: "codebase_existing" }).where(eq(task.id, existing_id));

		const diff_item = new_diff_item("codebase_new", "src/feature.ts", {
			parent_id: existing_id,
			proposing_task_id: existing_id,
		});
		const update_id = await seed_pending_update([diff_item]);

		const result = await processScanResults(db, project_id, owner_id, update_id, { CREATE: [diff_item.id] }, {}, true);
		expect(result.ok).toBe(true);

		const new_rows = await db.select().from(task).where(eq(task.codebase_task_id, "codebase_new"));
		expect(new_rows.length).toBe(1);
		expect(new_rows[0]?.parent_id).toBe(existing_id);

		const edges = await db
			.select()
			.from(task_link)
			.where(and(eq(task_link.src_id, new_rows[0].id), eq(task_link.kind, "discovered_from")));
		expect(edges.length).toBe(1);
		expect(edges[0]?.dst_id).toBe(existing_id);
	});

	test("no match falls back to project root with no edge", async () => {
		const diff_item = new_diff_item("codebase_orphan", "src/unmatched.ts", {
			parent_id: null,
			proposing_task_id: null,
		});
		const update_id = await seed_pending_update([diff_item]);

		const result = await processScanResults(db, project_id, owner_id, update_id, { CREATE: [diff_item.id] }, {}, true);
		expect(result.ok).toBe(true);

		const new_rows = await db.select().from(task).where(eq(task.codebase_task_id, "codebase_orphan"));
		expect(new_rows.length).toBe(1);
		expect(new_rows[0]?.parent_id).toBeNull();

		const edges = await db.select().from(task_link).where(eq(task_link.src_id, new_rows[0].id));
		expect(edges.length).toBe(0);
	});

	test("a proposal that would exceed the depth cap is rejected, task stays at root", async () => {
		// Build a chain of GRAPH_DEPTH_CAP tasks (root..depth-8) directly —
		// seeding bypasses guards, simulating an already-deep tree.
		let parent_id: string | null = null;
		let deepest_id = "";
		for (let depth = 0; depth <= GRAPH_DEPTH_CAP; depth++) {
			deepest_id = await seed_open_task({ title: `depth ${String(depth)}`, parent_id });
			parent_id = deepest_id;
		}
		await seed_codebase_task("codebase_deep", "src/deep.ts");
		await db.update(task).set({ codebase_task_id: "codebase_deep" }).where(eq(task.id, deepest_id));

		const diff_item = new_diff_item("codebase_new_deep", "src/deep.ts", {
			parent_id: deepest_id,
			proposing_task_id: deepest_id,
		});
		const update_id = await seed_pending_update([diff_item]);

		const result = await processScanResults(db, project_id, owner_id, update_id, { CREATE: [diff_item.id] }, {}, true);
		expect(result.ok).toBe(true);

		const new_rows = await db.select().from(task).where(eq(task.codebase_task_id, "codebase_new_deep"));
		expect(new_rows.length).toBe(1);
		expect(new_rows[0]?.parent_id).toBeNull();

		const edges = await db.select().from(task_link).where(eq(task_link.src_id, new_rows[0].id));
		expect(edges.length).toBe(0);
	});
});
