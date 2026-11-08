/**
 * @module pipelines/__tests__/integration/external-routes
 *
 * Route-level coverage for external deploy mode (#155): creation mode
 * mismatch, the CI-via-webhook acceptance flow through the real routes +
 * in-memory DO, human-only redispatch + external rollback, and
 * no_previous_commit.
 *
 * Same substrate as `helpers.ts` (bun:sqlite + migrate, in-memory
 * Cloudflare provider, in-memory DO namespace) with an extra
 * `InMemoryDispatcher` on RunDeps and an external-mode package row.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { InMemoryDispatcher, InMemoryDurableObjectNamespace } from "@devpad/pipeline-fakes";
import type { RunDeps } from "@devpad/core/services/pipelines";
import { extendTemplate } from "@devpad/pipeline-templates";
import type { PipelineRun } from "@devpad/schema";
import type { Database } from "@devpad/schema/database/types";
import { pipeline_run } from "@devpad/schema/database/schema";
import { eq } from "drizzle-orm";
import {
	build_test_auth_gate,
	create_test_db,
	make_run_deps,
	post_json,
	seed_package,
	seed_user,
	test_admin_headers,
	test_human_headers,
	TEST_SESSION_TOKEN,
	type TestSessionClaims,
} from "./helpers";
import {
	make_routes,
	type RoutesDeps,
	type TemplateResolver,
	type ManifestProvider,
	type LineageProvider,
} from "../../src/routes";
import { make_run_handler } from "../../src/run-do";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

const EXTERNAL_TARGET = {
	repo: "acme/my-pkg",
	workflow: "deploy.yml",
	ref: "main",
	timeout_ms: 2_700_000,
	gate: { type: "manual" },
};

const EXTERNAL_PACKAGE_ID = "pipeline-package_ext";

type Harness = {
	db: Database;
	dispatcher: InMemoryDispatcher;
	deps: ReturnType<typeof make_run_deps> & { dispatcher: InMemoryDispatcher };
	app: ReturnType<typeof make_routes>;
	namespace: InMemoryDurableObjectNamespace<{ deps: RunDeps }>;
	fire_alarm: (run_id: string) => Promise<void>;
};

const SESSION_CLAIMS: TestSessionClaims = {
	scope: ["runs:start", "runs:events", "runs:cancel", "runs:rollback"],
	package_ids: [EXTERNAL_PACKAGE_ID],
};

async function build_harness(): Promise<Harness> {
	const db = create_test_db();
	const u = await seed_user(db);
	// Orchestrated default package (id pipeline-package_test)…
	await seed_package(db, u.id);
	// …plus the external-mode one.
	await seed_package(db, u.id, {
		id: EXTERNAL_PACKAGE_ID,
		name: "ext-pkg",
		deploy_mode: "external",
		external_target: EXTERNAL_TARGET,
	});

	const dispatcher = new InMemoryDispatcher();
	const deps = { ...make_run_deps(db), dispatcher };

	const built = extendTemplate({});
	if (!built.ok) throw new Error("template build failed");
	const template = built.value;

	const manifest_in: ManifestProvider = { get: async () => null };
	const templates: TemplateResolver = { resolve: async () => template };
	const lineage: LineageProvider = { previous: async () => null };

	const namespace = new InMemoryDurableObjectNamespace<{ deps: RunDeps }>({ deps }, (ctx, env) => {
		const handler = make_run_handler(ctx, { deps: env.deps });
		return { fetch: handler.handle, alarm: handler.fire_alarm };
	});

	const routes_deps: RoutesDeps = {
		db,
		do_router: {
			get(run_id: string) {
				return {
					fetch: (req: Request) => namespace.get(namespace.idFromName(run_id)).fetch(req),
				};
			},
		},
		manifests: manifest_in,
		templates,
		lineage,
		auth: build_test_auth_gate(SESSION_CLAIMS),
	};
	const app = make_routes(() => routes_deps);

	return {
		db,
		dispatcher,
		deps,
		app,
		namespace,
		fire_alarm: async (run_id) => {
			const stub = namespace.get(namespace.idFromName(run_id));
			await stub.manualFireAlarm();
		},
	};
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

const run_of = async (db: Database, run_id: string) =>
	(await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id))).at(0)!;

const post_event = (
	app: Harness["app"],
	run_id: string,
	body: unknown,
	headers: Record<string, string> = test_admin_headers(),
) => post_json<unknown>(app, `/runs/${run_id}/events`, body, headers);

const valid_event = (over: Record<string, unknown> = {}) => ({
	stage_name: "staging",
	kind: "deploy_completed",
	payload: { sha: COMMIT_A },
	idempotency_key: "11111111-1111-4111-8111-111111111111",
	...over,
});

async function complete_run_through_db(h: Harness, run_id: string, sha: string = COMMIT_A): Promise<void> {
	await wait_until_status(h.db, run_id, "deploying");
	const staged = await post_event(
		h.app,
		run_id,
		valid_event({ idempotency_key: crypto.randomUUID(), payload: { sha } }),
	);
	expect(staged.status).toBeLessThan(400);
	await wait_until_status(h.db, run_id, "awaiting_approval");

	const approved = await post_json(
		h.app,
		`/runs/${run_id}/approve`,
		{ stage_name: "production", decision: "approved" },
		test_human_headers("user_test"),
	);
	expect(approved.status).toBe(200);
	await wait_until_status(h.db, run_id, "deploying", 5_000);

	const finished = await post_event(h.app, run_id, {
		...valid_event({ idempotency_key: crypto.randomUUID(), stage_name: "production", payload: { sha } }),
	});
	expect(finished.status).toBeLessThan(400);
	await wait_until_status(h.db, run_id, "completed");
}

describe("POST /runs — deploy-mode gating", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("commit body on an orchestrated package → 400 deploy_mode_mismatch", async () => {
		const res = await post_json(h.app, "/runs", { package_id: "pipeline-package_test", commit_sha: COMMIT_A });
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("deploy_mode_mismatch");
	});

	test("version_set body on an external package → 400 deploy_mode_mismatch", async () => {
		const res = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, version_set_id: "vs_v1" });
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("deploy_mode_mismatch");
	});

	test("both/neither target → 400 invalid_body", async () => {
		const both = await post_json(h.app, "/runs", {
			package_id: EXTERNAL_PACKAGE_ID,
			version_set_id: "vs_v1",
			commit_sha: COMMIT_A,
		});
		expect(both.status).toBe(400);
		expect(both.body.error?.code).toBe("invalid_body");

		const neither = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID });
		expect(neither.status).toBe(400);
	});

	test("external commit body: 200 and parks in deploying/staging with zero dispatches", async () => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		expect(created.status).toBe(200);
		const run_id = (created.body.value as { run_id: string }).run_id;
		const row = await run_of(h.db, run_id);
		expect(row.status).toBe("deploying");
		expect(row.current_stage).toBe("staging");
		expect(row.commit_sha).toBe(COMMIT_A);
		expect(row.version_set_id).toBeNull();
		expect(h.dispatcher.dispatched).toHaveLength(0);
	});
});

describe("external mode — full CI acceptance flow over the routes", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("staging event → awaiting → human approve → ONE dispatch → production events → completed", async () => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const staged = await post_event(h.app, run_id, valid_event());
		expect(staged.status).toBe(201);
		await wait_until_status(h.db, run_id, "awaiting_approval");

		const approved = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "production", decision: "approved" },
			test_human_headers("user_test"),
		);
		expect(approved.status).toBe(200);

		expect(h.dispatcher.dispatched).toHaveLength(1);
		expect(h.dispatcher.dispatched[0].inputs).toEqual({ stage: "production", sha: COMMIT_A, run_id });
		await wait_until_status(h.db, run_id, "deploying");

		const finished = await post_event(
			h.app,
			run_id,
			valid_event({ stage_name: "production", idempotency_key: "22222222-2222-4222-8222-222222222222" }),
		);
		expect(finished.status).toBe(201);
		await wait_until_status(h.db, run_id, "completed");
	});

	test("duplicate idempotency key → duplicated:true, single row", async () => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const first = await post_event(h.app, run_id, valid_event());
		const second = await post_event(h.app, run_id, valid_event());
		expect(first.status).toBe(201);
		expect(second.status).toBe(200);
		expect((second.body.value as { duplicated: boolean }).duplicated).toBe(true);
		expect((second.body.value as { event_id: string }).event_id).toBe(
			(first.body.value as { event_id: string }).event_id,
		);
		await wait_until_status(h.db, run_id, "awaiting_approval");
	});

	test("wrong-sha event records the row but does NOT transition", async () => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const wrong = await post_event(
			h.app,
			run_id,
			valid_event({ payload: { sha: COMMIT_B }, idempotency_key: "33333333-3333-4333-8333-333333333333" }),
		);
		expect(wrong.status).toBe(201);
		await Bun.sleep(30);
		const row = await run_of(h.db, run_id);
		expect(row.status).toBe("deploying");
	});
});

describe("POST /runs/:id/redispatch — human-only", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	const make_failing_run = async (): Promise<string> => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");
		await post_event(h.app, run_id, valid_event());
		await wait_until_status(h.db, run_id, "awaiting_approval");
		h.dispatcher.fail_next = "dispatch bounced (503)";
		const approved = await post_json(
			h.app,
			`/runs/${run_id}/approve`,
			{ stage_name: "production", decision: "approved" },
			test_human_headers("user_test"),
		);
		expect(approved.status).toBe(200);
		await wait_until_status(h.db, run_id, "deploying");
		expect(h.dispatcher.dispatched).toHaveLength(0);
		return run_id;
	};

	test("session identity → 403 human_approval_required", async () => {
		const run_id = await make_failing_run();
		const res = await post_json(
			h.app,
			`/runs/${run_id}/redispatch`,
			{},
			{
				authorization: `Bearer ${TEST_SESSION_TOKEN}`,
			},
		);
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("human_approval_required");
	});

	test("admin bearer without actor headers → 403", async () => {
		const run_id = await make_failing_run();
		const res = await post_json(h.app, `/runs/${run_id}/redispatch`, {}, test_admin_headers());
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("human_approval_required");
	});

	test("human redispatch flips failed → dispatched exactly once; second is rejected", async () => {
		const run_id = await make_failing_run();
		const ok_call = await post_json(h.app, `/runs/${run_id}/redispatch`, {}, test_human_headers("user_other"));
		expect(ok_call.status).toBe(200);
		expect(h.dispatcher.dispatched).toHaveLength(1);
		expect(h.dispatcher.dispatched[0].inputs).toEqual({ stage: "production", sha: COMMIT_A, run_id });
		await wait_until_status(h.db, run_id, "deploying");
	});
});

describe("POST /runs/:id/rollback — external branch", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("session identity → 403 human_approval_required", async () => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const res = await post_json(
			h.app,
			`/runs/${run_id}/rollback`,
			{},
			{
				authorization: `Bearer ${TEST_SESSION_TOKEN}`,
			},
		);
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("human_approval_required");
	});

	test("no completed predecessor → 400 no_previous_commit", async () => {
		const created = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_id = (created.body.value as { run_id: string }).run_id;
		await wait_until_status(h.db, run_id, "deploying");

		const res = await post_json(h.app, `/runs/${run_id}/rollback`, {}, test_human_headers("user_test"));
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("no_previous_commit");
	});

	test("happy path: dispatches the previous completed run's SHA via a rollback run", async () => {
		// Run A (commit A): create → CI → approve → CI → completed.
		const created_a = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_A });
		const run_a = (created_a.body.value as { run_id: string }).run_id;
		await complete_run_through_db(h, run_a);

		// Run B (commit B): complete as well, so most-recent-completed is B
		// and the exclusion logic has to pick A.
		const created_b = await post_json(h.app, "/runs", { package_id: EXTERNAL_PACKAGE_ID, commit_sha: COMMIT_B });
		const run_b = (created_b.body.value as { run_id: string }).run_id;
		await complete_run_through_db(h, run_b, COMMIT_B);
		const dispatches_before = h.dispatcher.dispatched.length;

		const rollback = await post_json(h.app, `/runs/${run_b}/rollback`, {}, test_human_headers("user_test"));
		expect(rollback.status).toBe(200);
		const value = rollback.body.value as { run_id: string; kind: string; target_commit_sha: string };
		expect(value.kind).toBe("rollback");
		expect(value.target_commit_sha).toBe(COMMIT_A);

		// One fresh dispatch of the rollback run's production stage —
		// targeting run A's SHA, attributed to the human.
		expect(h.dispatcher.dispatched.length).toBe(dispatches_before + 1);
		const last = h.dispatcher.dispatched.at(-1)!;
		expect(last.inputs).toEqual({ stage: "production", sha: COMMIT_A, run_id: value.run_id });

		const rollback_row = await run_of(h.db, value.run_id);
		expect(rollback_row.commit_sha).toBe(COMMIT_A);
		expect(rollback_row.version_set_id).toBeNull();
		expect(rollback_row.status).toBe("deploying");

		// CI reports the rollback deploy for the rollback run.
		const finished = await post_event(
			h.app,
			value.run_id,
			valid_event({ stage_name: "production", idempotency_key: crypto.randomUUID() }),
		);
		expect(finished.status).toBeLessThan(400);
		await wait_until_status(h.db, value.run_id, "completed");
	});
});
