import { Database as BunSqlite } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { pipeline_package, pipeline_run, project, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { Hono } from "hono";
import type { AppContext } from "../bindings.js";
import pipelines_dashboard_routes from "../routes/v1/pipelines-dashboard.js";

/**
 * Integration-flavoured test for `/v1/pipelines/dashboard`. We spin up an
 * in-memory bun:sqlite db with the real schema migrations, seed user/project/
 * pipeline_package/pipeline_run rows, wire the route into a minimal Hono
 * app, and exercise the full ownership + aggregator round-trip without
 * needing a worker harness.
 *
 * Covers:
 *   - 200 happy path: ownership passes, snapshot returns with non-zero counts
 *   - 403 forbidden: ownership check happens BEFORE any pipeline_* read
 *   - 401 unauthorized when no user is set
 *   - pulse-unreachable → `pulse: null`, response still 200 (NOT 503)
 *   - Cache-Control: public, max-age=30 stamped on success
 */

const PROJECT_ID = "proj_test";
const USER_ID = "user_test";
const PKG_ID = "pipeline-package_test";

type DashboardResponseBody = {
	run_counts: { total: number; completed: number };
	latency_p50_ms: number;
	pulse: { totals: { requests: number } } | null;
};

const make_db = (): Database => {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
};

const seed_baseline = async (db: Database, opts: { with_runs?: boolean } = {}): Promise<void> => {
	const now = new Date().toISOString();
	const user_row = {
		id: USER_ID,
		name: "tester",
		email: `${USER_ID}@test.example`,
		email_verified: now,
		image_url: "https://example.com/x.png",
		task_view: "list",
		created_at: now,
		updated_at: now,
	};
	await db.insert(user).values(user_row as never);
	const project_row = {
		id: PROJECT_ID,
		owner_id: USER_ID,
		name: "test-project",
		project_id: PROJECT_ID,
		visibility: "PRIVATE",
		status: "DEVELOPMENT",
		created_at: now,
		updated_at: now,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	};
	await db.insert(project).values(project_row as never);
	const pipeline_package_row = {
		id: PKG_ID,
		owner_id: USER_ID,
		name: "test-pkg",
		repo_url: null,
		default_template_ref: null,
		project_id: PROJECT_ID,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	};
	await db.insert(pipeline_package).values(pipeline_package_row as never);

	if (opts.with_runs) {
		const base = Date.now();
		const start = new Date(base - 10 * 60_000).toISOString();
		const finish = new Date(base - 5 * 60_000).toISOString();
		const pipeline_run_row = {
			id: "pipeline-run_1",
			package_id: PKG_ID,
			version_set_id: "vs_v1",
			shape: "atomic",
			kind: "deploy",
			status: "completed",
			current_stage: null,
			resolved_rollout: { type: "atomic" },
			resolved_gates: { "staging→atomic-prod": { type: "manual" } },
			forced_atomic_reason: null,
			started_at: start,
			finished_at: finish,
			created_at: start,
			updated_at: finish,
			created_by: "api",
			modified_by: "api",
			protected: false,
			deleted: false,
		};
		await db.insert(pipeline_run).values(pipeline_run_row as never);
	}
};

type BuildOpts = {
	authed?: boolean;
	pulse_api_base?: string;
	pulse_internal_key?: string;
	pulse_upstream?: ((req: { url: string; method: string }) => Response) | null;
};

const build_app = (
	db: Database,
	opts: BuildOpts,
): { app: Hono<AppContext>; restore: () => void; captured: Array<{ url: string; method: string }> } => {
	const captured: Array<{ url: string; method: string }> = [];
	const original_fetch = globalThis.fetch;
	if (opts.pulse_upstream !== undefined) {
		globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const method = init?.method ?? "GET";
			captured.push({ url, method });
			if (opts.pulse_upstream === null) throw new Error("pulse unreachable");
			return opts.pulse_upstream!({ url, method });
		};
	}

	const app = new Hono<AppContext>();
	app.use("*", async (c, next) => {
		c.set("db", db as never);
		const config_stub = {
			environment: "test",
			api_url: "http://test",
			frontend_url: "http://test",
			jwt_secret: "x",
			encryption_key: "x",
			pulse_api_base: opts.pulse_api_base,
			pulse_internal_key: opts.pulse_internal_key,
		};
		c.set("config", config_stub as never);
		if (opts.authed) {
			const user_stub = { id: USER_ID, github_id: 1, name: "stub", task_view: "list" };
			c.set("user", user_stub as never);
			c.set("session", null);
			c.set("auth_channel", "api");
			c.set("api_key_scope", "pipelines");
		} else {
			c.set("user", null as never);
			c.set("session", null);
			c.set("auth_channel", "user");
			c.set("api_key_scope", null);
		}
		await next();
	});
	app.route("/v1/pipelines", pipelines_dashboard_routes);

	const restore = () => {
		globalThis.fetch = original_fetch;
	};

	return { app, restore, captured };
};

describe("/v1/pipelines/dashboard", () => {
	let teardown: (() => void) | null = null;

	afterEach(() => {
		teardown?.();
		teardown = null;
	});

	it("200: returns aggregated snapshot for owned project with runs", async () => {
		const db = make_db();
		await seed_baseline(db, { with_runs: true });
		const { app, restore } = build_app(db, {
			authed: true,
			pulse_api_base: "https://pulse.test",
			pulse_internal_key: "internal_secret",
			pulse_upstream: () =>
				new Response(JSON.stringify({ totals: { requests: 99 } }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		});
		teardown = restore;

		const res = await app.fetch(new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}`));
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=30");

		const raw: unknown = await res.json();
		const body = raw as DashboardResponseBody;
		expect(body.run_counts.total).toBe(1);
		expect(body.run_counts.completed).toBe(1);
		expect(body.latency_p50_ms).toBe(5 * 60_000);
		expect(body.pulse).not.toBeNull();
		expect(body.pulse?.totals.requests).toBe(99);
	});

	it("403: ownership check fails BEFORE any pipeline read", async () => {
		const db = make_db();
		await seed_baseline(db, { with_runs: true });
		// Different user, not the project owner.
		const { app, restore } = build_app(db, {
			authed: true,
			pulse_api_base: "https://pulse.test",
			pulse_internal_key: "internal_secret",
		});
		teardown = restore;

		// Override the user to one that does NOT own the project.
		// Easiest: post against a project_id that exists but is owned by USER_ID
		// from a stub user with a different id. We hack the context middleware
		// here by re-creating the app with a different user id.
		const app2 = new Hono<AppContext>();
		app2.use("*", async (c, next) => {
			c.set("db", db as never);
			const config_stub = {
				environment: "test",
				api_url: "x",
				frontend_url: "x",
				jwt_secret: "x",
				encryption_key: "x",
			};
			c.set("config", config_stub as never);
			const user_stub = { id: "user_attacker", github_id: 2, name: "stub", task_view: "list" };
			c.set("user", user_stub as never);
			c.set("session", null);
			c.set("auth_channel", "api");
			c.set("api_key_scope", "pipelines");
			await next();
		});
		app2.route("/v1/pipelines", pipelines_dashboard_routes);

		const res = await app2.fetch(new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}`));
		expect(res.status).toBe(403);
		void app;
	});

	it("401: no user → unauthorized, no upstream fetch", async () => {
		const db = make_db();
		await seed_baseline(db);
		const { app, restore, captured } = build_app(db, {
			authed: false,
			pulse_api_base: "https://pulse.test",
			pulse_internal_key: "internal_secret",
			pulse_upstream: () => new Response("{}", { status: 200 }),
		});
		teardown = restore;

		const res = await app.fetch(new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}`));
		expect(res.status).toBe(401);
		expect(captured.length).toBe(0);
	});

	it("400: missing project_id query", async () => {
		const db = make_db();
		await seed_baseline(db);
		const { app, restore } = build_app(db, { authed: true });
		teardown = restore;

		const res = await app.fetch(new Request("http://test/v1/pipelines/dashboard"));
		expect(res.status).toBe(400);
	});

	it("pulse unreachable → response still 200 with pulse: null", async () => {
		const db = make_db();
		await seed_baseline(db, { with_runs: true });
		const { app, restore } = build_app(db, {
			authed: true,
			pulse_api_base: "https://pulse.test",
			pulse_internal_key: "internal_secret",
			pulse_upstream: null, // throws — simulates network failure
		});
		teardown = restore;

		const res = await app.fetch(new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}`));
		expect(res.status).toBe(200);
		const raw: unknown = await res.json();
		const body = raw as DashboardResponseBody;
		expect(body.pulse).toBeNull();
	});

	it("pulse not configured → response 200 with pulse: null (no fetch attempted)", async () => {
		const db = make_db();
		await seed_baseline(db, { with_runs: true });
		const { app, restore, captured } = build_app(db, {
			authed: true,
			// no pulse_api_base / pulse_internal_key
			pulse_upstream: () => new Response("{}", { status: 200 }),
		});
		teardown = restore;

		const res = await app.fetch(new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}`));
		expect(res.status).toBe(200);
		const raw: unknown = await res.json();
		const body = raw as DashboardResponseBody;
		expect(body.pulse).toBeNull();
		expect(captured.length).toBe(0);
	});

	it("project with no pipeline_package → 200 with empty snapshot", async () => {
		const db = make_db();
		await seed_baseline(db, { with_runs: false });
		// Drop the package row so the project has no pipeline link.
		await db.delete(pipeline_package);
		const { app, restore } = build_app(db, { authed: true });
		teardown = restore;

		const res = await app.fetch(new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}`));
		expect(res.status).toBe(200);
		const raw: unknown = await res.json();
		const body = raw as DashboardResponseBody;
		expect(body.run_counts.total).toBe(0);
		expect(body.pulse).toBeNull();
	});

	it("window_ms: invalid value → 400", async () => {
		const db = make_db();
		await seed_baseline(db);
		const { app, restore } = build_app(db, { authed: true });
		teardown = restore;

		const res = await app.fetch(
			new Request(`http://test/v1/pipelines/dashboard?project_id=${PROJECT_ID}&window_ms=-1`),
		);
		expect(res.status).toBe(400);
	});
});

void beforeEach;
