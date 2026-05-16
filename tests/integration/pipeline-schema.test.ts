import { Database as BunSqlite } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { pipeline_analysis_template, pipeline_approval, pipeline_grant, pipeline_package, pipeline_run, pipeline_stage_event, user } from "@devpad/schema";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";

const migrations_folder = path.resolve(process.cwd(), "packages/schema/src/database/drizzle");

let sqlite: BunSqlite;
let db: Database;
let owner_id: string;
let package_id: string;
let run_id: string;

beforeAll(async () => {
	sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite, migrations_folder);
	db = createBunDatabase(sqlite);

	const [u] = await db.insert(user).values({ id: `user_pipeline_schema_test`, name: "Pipeline Schema Tester", email: "pipeline-schema@devpad.test" }).returning();
	owner_id = u.id;
});

afterAll(() => {
	sqlite.close();
});

describe("pipeline schema round-trips", () => {
	test("inserts and reads a pipeline_package row", async () => {
		const [pkg] = await db.insert(pipeline_package).values({ owner_id, name: "anthropic-search", repo_url: "https://github.com/example/anthropic-search" }).returning();

		expect(pkg.id).toMatch(/^pipeline-package_/);
		expect(pkg.name).toBe("anthropic-search");
		expect(pkg.created_by).toBe("user");
		expect(pkg.protected).toBe(false);

		const fetched = await db.select().from(pipeline_package).where(eq(pipeline_package.id, pkg.id)).all();
		expect(fetched).toHaveLength(1);
		expect(fetched[0].repo_url).toBe("https://github.com/example/anthropic-search");

		package_id = pkg.id;
	});

	test("inserts and reads a pipeline_run row with resolved JSON snapshots", async () => {
		const resolved_rollout = {
			type: "gradual" as const,
			stages: [
				{ name: "onebox", traffic: 1, bake: "30m" },
				{ name: "wave1", traffic: 10, bake: "1h" },
			],
		};
		const resolved_gates = {
			"staging->onebox": { type: "manual" as const },
			"onebox->wave1": { type: "auto" as const, afterBake: true },
		};

		const [run] = await db
			.insert(pipeline_run)
			.values({
				package_id,
				version_set_id: "vs_abc123",
				shape: "gradual",
				status: "queued",
				resolved_rollout,
				resolved_gates,
			})
			.returning();

		expect(run.shape).toBe("gradual");
		expect(run.status).toBe("queued");
		expect(run.forced_atomic_reason).toBeNull();

		const fetched = await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)).all();
		expect(fetched).toHaveLength(1);
		expect(fetched[0].resolved_rollout).toEqual(resolved_rollout);
		expect(fetched[0].resolved_gates).toEqual(resolved_gates);

		run_id = run.id;
	});

	test("inserts and reads a pipeline_stage_event row of kind 'gate_verdict'", async () => {
		const payload = { type: "manual", verdict: "Pass", reason: "approved by tom" };
		const [event] = await db.insert(pipeline_stage_event).values({ run_id, stage_name: "onebox", kind: "gate_verdict", payload }).returning();

		expect(event.kind).toBe("gate_verdict");
		expect(event.id).toMatch(/^pipeline-stage-event_/);

		const fetched = await db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id)).all();
		expect(fetched).toHaveLength(1);
		expect(fetched[0].payload).toEqual(payload);
	});

	test("inserts and reads a pipeline_grant row with scope string", async () => {
		const [grant] = await db
			.insert(pipeline_grant)
			.values({
				package_id,
				stage_name: "staging",
				scope: "anthropic:messages",
				granted_by: owner_id,
				granted_at: new Date().toISOString(),
			})
			.returning();

		expect(grant.scope).toBe("anthropic:messages");
		expect(grant.stage_name).toBe("staging");

		const fetched = await db.select().from(pipeline_grant).where(eq(pipeline_grant.package_id, package_id)).all();
		expect(fetched).toHaveLength(1);
		expect(fetched[0].granted_by).toBe(owner_id);
	});

	test("inserts and reads a pipeline_approval row", async () => {
		const [approval] = await db
			.insert(pipeline_approval)
			.values({
				run_id,
				stage_name: "onebox",
				decision: "approved",
				reason: "looks good",
				decided_by: owner_id,
				decided_at: new Date().toISOString(),
			})
			.returning();

		expect(approval.decision).toBe("approved");
		expect(approval.id).toMatch(/^pipeline-approval_/);

		const fetched = await db.select().from(pipeline_approval).where(eq(pipeline_approval.run_id, run_id)).all();
		expect(fetched).toHaveLength(1);
		expect(fetched[0].reason).toBe("looks good");
	});

	test("inserts and reads a pipeline_analysis_template row", async () => {
		const query_dsl = { metric: "error_rate", window: "5m" };
		const threshold_dsl = { op: "lt", value: 0.01 };

		const [template] = await db
			.insert(pipeline_analysis_template)
			.values({
				owner_id,
				name: "default-error-rate",
				query_dsl,
				threshold_dsl,
			})
			.returning();

		expect(template.name).toBe("default-error-rate");
		expect(template.id).toMatch(/^pipeline-analysis-template_/);

		const fetched = await db.select().from(pipeline_analysis_template).where(eq(pipeline_analysis_template.id, template.id)).all();
		expect(fetched).toHaveLength(1);
		expect(fetched[0].query_dsl).toEqual(query_dsl);
		expect(fetched[0].threshold_dsl).toEqual(threshold_dsl);
	});
});
