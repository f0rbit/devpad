/**
 * @module core/services/pipelines/__tests__/integration/run-row-parse
 *
 * verification-hardening 2.1: the `pipeline_run.resolved_rollout` /
 * `resolved_gates` json columns are Zod-parsed at the core read boundary
 * (`row-parse.ts`) — a corrupted row must surface as a typed `store_error`
 * on `get_run`/`list_runs`, never as a silently-wrong object flowing into
 * the state machine or the UI.
 *
 * The malformed row is inserted via raw SQL on purpose: the typed drizzle
 * insert path ($type<ResolvedGates>()) can't express the corruption, which
 * is exactly the point — only a raw write (a bug, a hand-edit, a migration
 * gone wrong) can produce it.
 */

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { pipeline_run } from "@devpad/schema/database/schema";
import { create_test_db, seed_package, seed_user } from "./helpers.js";
import { get_run, list_runs } from "../../runs.js";

const seed_raw_run = async (
	db: Awaited<ReturnType<typeof create_test_db>>,
	package_id: string,
	run_id: string,
	resolved_gates_sql: string,
): Promise<void> => {
	await db.run(sql`
		INSERT INTO pipeline_run (id, package_id, shape, resolved_rollout, resolved_gates)
		VALUES (${run_id}, ${package_id}, 'gradual', '{"type":"atomic"}', ${resolved_gates_sql})
	`);
};

describe("pipeline_run resolved_* column parsing (row-parse)", () => {
	test("a malformed resolved_gates row yields store_error on get_run, not a silent row", async () => {
		const db = create_test_db();
		const user_row = await seed_user(db);
		const pkg = await seed_package(db, user_row.id);
		await seed_raw_run(db, pkg.id, "pipeline-run_bad", '{"staging→production":{"type":"bogus"}}');

		const result = await get_run(db, "pipeline-run_bad");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("store_error");
			if (result.error.kind === "store_error") {
				expect(result.error.operation).toBe("read_pipeline_run");
				expect(result.error.message).toContain("resolved_gates");
			}
		}
	});

	test("a malformed resolved_rollout row yields store_error on get_run", async () => {
		const db = create_test_db();
		const user_row = await seed_user(db);
		const pkg = await seed_package(db, user_row.id);
		await db.run(sql`
			INSERT INTO pipeline_run (id, package_id, shape, resolved_rollout, resolved_gates)
			VALUES ('pipeline-run_bad_rollout', ${pkg.id}, 'gradual', '{"type":"sideways"}', '{}')
		`);

		const result = await get_run(db, "pipeline-run_bad_rollout");
		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "store_error") {
			expect(result.error.message).toContain("resolved_rollout");
		}
	});

	test("list_runs fails on any malformed row in the result set", async () => {
		const db = create_test_db();
		const user_row = await seed_user(db);
		const pkg = await seed_package(db, user_row.id);
		await db.insert(pipeline_run).values({
			id: "pipeline-run_ok",
			package_id: pkg.id,
			version_set_id: "vs_ok",
			shape: "atomic",
			resolved_rollout: { type: "atomic" },
			resolved_gates: { "staging→atomic-prod": { type: "manual" } },
		});
		await seed_raw_run(db, pkg.id, "pipeline-run_bad", '{"staging→production":{"type":"bogus"}}');

		const result = await list_runs(db, { package_id: pkg.id });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("store_error");
	});

	test("a well-formed typed insert still reads through", async () => {
		const db = create_test_db();
		const user_row = await seed_user(db);
		const pkg = await seed_package(db, user_row.id);
		await db.insert(pipeline_run).values({
			id: "pipeline-run_ok",
			package_id: pkg.id,
			version_set_id: "vs_ok",
			shape: "atomic",
			resolved_rollout: { type: "atomic" },
			resolved_gates: { "staging→atomic-prod": { type: "manual" } },
		});

		const result = await get_run(db, "pipeline-run_ok");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.resolved_gates["staging→atomic-prod"]).toEqual({ type: "manual" });
			expect(result.value.resolved_rollout).toEqual({ type: "atomic" });
		}
	});
});
