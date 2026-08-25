import { Database as BunSqlite } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { project, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";

/**
 * v2.4 (task A5.4) — rewritten against a real in-memory SQLite db instead of
 * the pre-fold hand-rolled mock-db, which didn't (and couldn't easily) fake
 * `db.all(sql\`...\`)` — the raw-SQL query the scanner ⇄ graph reconciliation
 * heuristic (`proposeParent`) needs. `scanGitHubRepo`/`generateDiff` stay
 * `mock.module()`-mocked: that's the correct boundary (a real GitHub API
 * call isn't unit-testable), not something a real DB changes.
 */

mock.module("../scanner/index.js", () => ({
	scanGitHubRepo: async () => ({
		ok: true,
		value: [
			{
				id: "task_1",
				file: "src/main.ts",
				line: 10,
				tag: "todo",
				text: "Fix this",
				context: ["line 9", "line 10", "line 11"],
			},
		],
	}),
	generateDiff: () => [
		{
			id: "task_1",
			tag: "todo",
			type: "NEW",
			data: { old: null, new: { text: "Fix this", line: 10, file: "src/main.ts", context: [] } },
		},
	],
}));

const { initiateScan, getPendingUpdates, getScanHistory } = await import("../scanning.js");

function create_test_db(): Database {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
}

async function seed_user_row(db: Database): Promise<string> {
	const id = `user_scan_unit_${crypto.randomUUID()}`;
	await db.insert(user).values({
		id,
		name: "tester",
		email: `${id}@test.example`,
		task_view: "list",
	});
	return id;
}

async function seed_project_row(
	db: Database,
	owner_id: string,
	overrides: Partial<typeof project.$inferInsert> = {},
): Promise<string> {
	const id = overrides.id ?? `project_scan_unit_${crypto.randomUUID()}`;
	await db.insert(project).values({
		id,
		owner_id,
		project_id: id,
		name: "Test Project",
		status: "DEVELOPMENT",
		visibility: "PRIVATE",
		repo_url: "https://github.com/owner/repo",
		repo_id: 12345,
		scan_branch: "main",
		...overrides,
	});
	return id;
}

describe("scanning", () => {
	describe("initiateScan", () => {
		test("is an async generator", () => {
			const db = create_test_db();
			const generator = initiateScan(db, "project_123", "user_abc", "token_abc");
			expect(generator[Symbol.asyncIterator]).toBeDefined();
		});

		test("yields error for missing project", async () => {
			const db = create_test_db();
			const owner_id = await seed_user_row(db);

			const messages: string[] = [];
			for await (const msg of initiateScan(db, "project_missing", owner_id, "token_abc")) {
				messages.push(msg);
			}

			expect(messages).toContain("starting\n");
			expect(messages.some((m) => m.includes("error: project not found"))).toBe(true);
		});

		test("yields error for project without repo", async () => {
			const db = create_test_db();
			const owner_id = await seed_user_row(db);
			const project_id = await seed_project_row(db, owner_id, { repo_url: null });

			const messages: string[] = [];
			for await (const msg of initiateScan(db, project_id, owner_id, "token_abc")) {
				messages.push(msg);
			}

			expect(messages).toContain("starting\n");
			expect(messages.some((m) => m.includes("error: project not linked"))).toBe(true);
		});

		test("yields progress messages for successful scan", async () => {
			const db = create_test_db();
			const owner_id = await seed_user_row(db);
			const project_id = await seed_project_row(db, owner_id);

			const messages: string[] = [];
			for await (const msg of initiateScan(db, project_id, owner_id, "token_abc")) {
				messages.push(msg);
			}

			expect(messages).toContain("starting\n");
			expect(messages.some((m) => m.includes("scanning repo") || m.includes("loading config"))).toBe(true);
			expect(messages).toContain("done\n");
		});
	});

	describe("getPendingUpdates", () => {
		test("returns not_found for non-owned project", async () => {
			const db = create_test_db();
			const owner_id = await seed_user_row(db);
			const project_id = await seed_project_row(db, owner_id);

			const result = await getPendingUpdates(db, project_id, "user_wrong");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});

	describe("getScanHistory", () => {
		test("returns not_found for non-owned project", async () => {
			const db = create_test_db();
			const owner_id = await seed_user_row(db);
			const project_id = await seed_project_row(db, owner_id);

			const result = await getScanHistory(db, project_id, "user_wrong");
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.kind).toBe("not_found");
			}
		});
	});
});
