/**
 * @module pipelines/__tests__/integration/approvals-single-writer
 *
 * Regression tests for the #155 production incident: `approve_stage`
 * used to insert a `pipeline_approval` row DIRECTLY and then call
 * `write_decision` again — the D1 store's second insert carried
 * `decided_by: "system"`, which violates
 * `pipeline_approval.decided_by → user.id` on D1 (bun:sqlite tests ran
 * with foreign_keys OFF and never saw it).
 *
 * Now the approval store is the SINGLE writer, `decided_by` is always a
 * real user id, and every bun test DB runs `PRAGMA foreign_keys = ON`
 * (see `createBunDatabase`) so these tests reproduce D1 behaviour.
 *
 * Uses the real D1 approval store (`make_d1_approval_store`) as
 * `deps.approvals` — exactly the production wiring — against bun:sqlite
 * with FK enforcement live.
 */

import { describe, expect, test } from "bun:test";
import { InMemoryDispatcher, InMemoryDurableObjectNamespace } from "@devpad/pipeline-fakes";
import type { RunDeps } from "@devpad/core/services/pipelines";
import { extendTemplate } from "@devpad/pipeline-templates";
import type { PipelineRun } from "@devpad/schema";
import { pipeline_approval, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { make_d1_approval_store } from "../../src/providers/approval-store";
import {
	build_test_auth_gate,
	create_test_db,
	make_async_faithful_do_router,
	make_run_deps,
	post_json,
	seed_package,
	seed_user,
	test_human_headers,
} from "./helpers";
import {
	make_routes,
	type LineageProvider,
	type ManifestProvider,
	type RoutesDeps,
	type TemplateResolver,
} from "../../src/routes";
import { make_run_handler } from "../../src/run-do";

const COMMIT_A = "a".repeat(40);
const EXTERNAL_PACKAGE_ID = "pipeline-package_ext";

const EXTERNAL_TARGET = {
	repo: "acme/my-pkg",
	workflow: "deploy.yml",
	ref: "main",
	timeout_ms: 2_700_000,
	gate: { type: "manual" },
};

type Harness = {
	db: Database;
	dispatcher: InMemoryDispatcher;
	app: ReturnType<typeof make_routes>;
};

async function build_harness(): Promise<Harness> {
	const db = create_test_db();
	const u = await seed_user(db);
	await seed_package(db, u.id, {
		id: EXTERNAL_PACKAGE_ID,
		name: "ext-pkg",
		deploy_mode: "external",
		external_target: EXTERNAL_TARGET,
	});

	const dispatcher = new InMemoryDispatcher();
	// Production wiring: the D1 store is the single approval writer.
	const deps: RunDeps & { dispatcher: InMemoryDispatcher } = {
		...make_run_deps(db),
		approvals: make_d1_approval_store(db),
		dispatcher,
	};

	const built = extendTemplate({});
	if (!built.ok) throw new Error("template build failed");

	const manifests: ManifestProvider = { get: async () => null };
	const templates: TemplateResolver = { resolve: async () => built.value };
	const lineage: LineageProvider = { previous: async () => null };

	const namespace = new InMemoryDurableObjectNamespace<{ deps: RunDeps }>({ deps }, (ctx, env) => {
		const handler = make_run_handler(ctx, { deps: env.deps });
		return { fetch: handler.handle, alarm: handler.fire_alarm };
	});

	const do_router = make_async_faithful_do_router({
		get(run_id: string) {
			return {
				fetch: (req: Request) => namespace.get(namespace.idFromName(run_id)).fetch(req),
			};
		},
	});

	const routes_deps: RoutesDeps = {
		db,
		do_router,
		manifests,
		templates,
		lineage,
		auth: build_test_auth_gate(),
	};
	const app = make_routes(() => routes_deps);
	return { db, dispatcher, app };
}

const wait_until_status = async (db: Database, run_id: string, status: PipelineRun["status"], timeout_ms = 1_500) => {
	const deadline = Date.now() + timeout_ms;
	for (;;) {
		const row = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id))).at(0)!;
		if (row.status === status) return row;
		if (Date.now() > deadline) throw new Error(`run ${run_id} never reached ${status} (at ${row.status})`);
		await Bun.sleep(5);
	}
};

const approval_rows_of = async (db: Database, run_id: string) =>
	db.select().from(pipeline_approval).where(eq(pipeline_approval.run_id, run_id));

const stage_events_of = async (db: Database, run_id: string) =>
	db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id));

const staging_completed_event = {
	stage_name: "staging",
	kind: "deploy_completed",
	payload: { sha: COMMIT_A, environment: "staging" },
	idempotency_key: "11111111-1111-4111-8111-111111111111",
};

describe("approvals — single writer + FK-enforced decided_by", () => {
	test("human approve of an external run: ONE approval row, decided_by = the actor, gate_verdict event, run advances, ONE dispatch", async () => {
		const h = await build_harness();
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		expect(created.status).toBe(200);
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const staged = await post_json(h.app, `/runs/${run_id}/events`, staging_completed_event);
		expect(staged.status).toBe(201);
		await wait_until_status(h.db, run_id, "awaiting_approval");

		const approved = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "production", decision: "approved", reason: "looks good" },
			test_human_headers("user_test"),
		);
		expect(approved.status).toBe(200);
		expect(approved.body.ok).toBe(true);

		// Single approval row, decided_by = the real user actor (never a
		// "system" sentinel — that is what failed the FK on D1).
		const rows = await approval_rows_of(h.db, run_id);
		expect(rows).toHaveLength(1);
		expect(rows[0].decided_by).toBe("user_test");
		expect(rows[0].decision).toBe("approved");
		expect(rows[0].reason).toBe("looks good");

		// The verdict event is recorded and the run advanced to
		// deploying with the production dispatch claimed.
		const events = await stage_events_of(h.db, run_id);
		const verdicts = events.filter((e) => e.kind === "gate_verdict");
		expect(verdicts).toHaveLength(1);
		expect(verdicts[0].payload).toEqual({
			type: "manual",
			verdict: "Pass",
			reason: "looks good",
			decided_by: "user_test",
			decided_at: expect.any(String),
		});

		await wait_until_status(h.db, run_id, "deploying");
		expect(h.dispatcher.dispatched).toHaveLength(1);
		expect(h.dispatcher.dispatched[0].inputs).toEqual({ stage: "production", sha: COMMIT_A, run_id });
	});

	test("approve with an actor that is not a user → typed store_error (FK enforced in tests), no row, no advance", async () => {
		const h = await build_harness();
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const staged = await post_json(h.app, `/runs/${run_id}/events`, staging_completed_event);
		expect(staged.status).toBe(201);
		await wait_until_status(h.db, run_id, "awaiting_approval");

		const rejected = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "production", decision: "approved" },
			test_human_headers("user_ghost"),
		);
		// The FK violation surfaces as a typed store_error whose body now
		// carries the operation + message (the #155 error-visibility fix).
		expect(rejected.status).toBe(500);
		expect(rejected.body.ok).toBe(false);
		const error = rejected.body.error as { code: string; operation?: string; message?: string };
		expect(error.code).toBe("store_error");
		expect(error.operation).toBe("write_decision");
		expect(error.message).toContain("FOREIGN KEY");

		// Nothing was written and nothing advanced.
		const rows = await approval_rows_of(h.db, run_id);
		expect(rows).toHaveLength(0);
		const events = await stage_events_of(h.db, run_id);
		expect(events.some((e) => e.kind === "gate_verdict")).toBe(false);
		expect(h.dispatcher.dispatched).toHaveLength(0);
		const row = (await h.db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id))).at(0)!;
		expect(row.status).toBe("awaiting_approval");
	});
});
