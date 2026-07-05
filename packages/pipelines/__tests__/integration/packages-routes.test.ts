/**
 * @module pipelines/__tests__/integration/packages-routes
 *
 * Covers the bearer-gated package CRUD surface added in Phase 14:
 *
 * - `POST   /packages`       — register a new pipeline_package row.
 * - `PATCH  /packages/:id`   — partial update of an existing row.
 * - `DELETE /packages/:id`   — remove a row (refuses on active runs).
 *
 * Read routes (`GET /packages`, `GET /packages/:id`) remain unauthenticated
 * — they're already covered by `orchestrator-routes.test.ts`. Auth model
 * mirrors `/artifacts/*`: `Authorization: Bearer <PIPELINES_TOKEN>`.
 */

import { describe, expect, test } from "bun:test";
import { pipeline_package, pipeline_run, project } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Backend } from "@f0rbit/corpus";
import { create_memory_backend } from "@f0rbit/corpus";
import type { AuthError, AuthIdentity } from "../../src/auth";
import { is_bearer_valid } from "../../src/auth";
import { type AuthGate, make_routes, type PulseEmitterLite, type RoutesDeps } from "../../src/routes";
import { create_test_db, seed_package, seed_user } from "./helpers";

const PIPELINES_TOKEN = "test-token-AAAAAAAAAA";
const auth_header = (token: string) => `Bearer ${token}`;

type RouteSetup = {
	app: ReturnType<typeof make_routes>;
	db: Database;
	backend: Backend;
};

const build_setup = async (): Promise<RouteSetup> => {
	const db = create_test_db();
	await seed_user(db);
	const backend = create_memory_backend();
	const auth: AuthGate<AuthIdentity> = {
		check: async (request) => {
			const header = request.headers.get("authorization");
			if (!is_bearer_valid(header, PIPELINES_TOKEN)) {
				return {
					ok: false as const,
					error: { code: "unauthorized" as const, message: "bad token" } satisfies AuthError,
				};
			}
			return { ok: true as const, value: { kind: "admin" as const, reason: "pipelines_token" as const } };
		},
	};
	const pulse: PulseEmitterLite = { emit: async () => undefined };
	const deps: RoutesDeps = {
		db,
		do_router: { get: () => ({ fetch: async () => new Response("", { status: 500 }) }) },
		manifests: { get: async () => null },
		templates: { resolve: async () => null },
		lineage: { previous: async () => null },
		backend,
		auth,
		pulse,
	};
	return { app: make_routes(() => deps), db, backend };
};

const seed_project_row = async (db: Database, id: string, owner_id = "user_test"): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(project).values({
		id,
		project_id: id,
		owner_id,
		name: id,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	});
};

const seed_run_row = async (db: Database, package_id: string, run_id = "pipeline-run_a"): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id: run_id,
		package_id,
		version_set_id: "vs_v1",
		shape: "atomic",
		status: "queued",
		current_stage: null,
		resolved_rollout: { type: "atomic", stages: [] },
		resolved_gates: {},
		forced_atomic_reason: null,
		started_at: now,
		finished_at: null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	});
};

const post_json = async (
	app: ReturnType<typeof make_routes>,
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) => {
	const res = await app.fetch(
		new Request(`http://run.local${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
	return {
		status: res.status,
		body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> },
	};
};

const patch_json = async (
	app: ReturnType<typeof make_routes>,
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) => {
	const res = await app.fetch(
		new Request(`http://run.local${path}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
	return {
		status: res.status,
		body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> },
	};
};

const delete_req = async (app: ReturnType<typeof make_routes>, path: string, headers: Record<string, string> = {}) => {
	const res = await app.fetch(new Request(`http://run.local${path}`, { method: "DELETE", headers }));
	return {
		status: res.status,
		body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> },
	};
};

const valid_create_body = (overrides: Record<string, unknown> = {}) => ({
	id: "pipeline-package_new",
	name: "new-pkg",
	owner_id: "user_test",
	repo_url: "https://github.com/example/new-pkg",
	...overrides,
});

describe("POST /packages", () => {
	test("rejects missing Authorization with 401", async () => {
		const { app } = await build_setup();
		const res = await post_json(app, "/packages", valid_create_body());
		expect(res.status).toBe(401);
		expect(res.body.ok).toBe(false);
		expect(res.body.error?.code).toBe("unauthorized");
	});

	test("happy path creates a row and returns the wire envelope", async () => {
		const { app, db } = await build_setup();
		const res = await post_json(app, "/packages", valid_create_body(), { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		const created = res.body.value as { id: string; name: string; project_id: string | null };
		expect(created.id).toBe("pipeline-package_new");
		expect(created.name).toBe("new-pkg");
		expect(created.project_id).toBeNull();

		// Verify it landed in D1
		const rows = await db.select().from(pipeline_package);
		expect(rows.some((r) => r.id === "pipeline-package_new")).toBe(true);
	});

	test("duplicate id returns 409 with conflict code", async () => {
		const { app, db } = await build_setup();
		await seed_package(db, "user_test", { id: "pipeline-package_dup", name: "dup" });

		const res = await post_json(app, "/packages", valid_create_body({ id: "pipeline-package_dup", name: "dup" }), {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(409);
		expect(res.body.ok).toBe(false);
		expect(res.body.error?.code).toBe("conflict");
		expect(res.body.error?.resource).toBe("pipeline_package");
		expect(res.body.error?.id).toBe("pipeline-package_dup");
	});

	test("invalid project_id returns 404 not_found", async () => {
		const { app } = await build_setup();
		const res = await post_json(app, "/packages", valid_create_body({ project_id: "project_missing" }), {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
		expect(res.body.error?.resource).toBe("project");
	});

	test("valid project_id is accepted and stored", async () => {
		const { app, db } = await build_setup();
		await seed_project_row(db, "project_x");

		const res = await post_json(
			app,
			"/packages",
			valid_create_body({ id: "pipeline-package_linked", name: "linked", project_id: "project_x" }),
			{
				authorization: auth_header(PIPELINES_TOKEN),
			},
		);
		expect(res.status).toBe(200);
		const created = res.body.value as { project_id: string | null };
		expect(created.project_id).toBe("project_x");
	});

	test("malformed body returns 400 invalid_body", async () => {
		const { app } = await build_setup();
		const res = await post_json(
			app,
			"/packages",
			{ name: "missing-id" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_body");
	});
});

describe("PATCH /packages/:id", () => {
	test("partial update only touches provided fields", async () => {
		const { app, db } = await build_setup();
		await seed_package(db, "user_test", { id: "pipeline-package_u", name: "u", repo_url: "https://old.example/x" });

		const res = await patch_json(
			app,
			"/packages/pipeline-package_u",
			{ repo_url: "https://new.example/x" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(res.status).toBe(200);
		const updated = res.body.value as { repo_url: string | null; name: string };
		expect(updated.repo_url).toBe("https://new.example/x");
		expect(updated.name).toBe("u");
	});

	test("unknown id returns 404 not_found", async () => {
		const { app } = await build_setup();
		const res = await patch_json(
			app,
			"/packages/pipeline-package_missing",
			{ repo_url: "https://example.com" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});

	test("missing auth returns 401", async () => {
		const { app } = await build_setup();
		const res = await patch_json(app, "/packages/pipeline-package_u", { repo_url: "https://example.com" });
		expect(res.status).toBe(401);
	});
});

describe("DELETE /packages/:id", () => {
	test("deletes a package with no runs and returns deleted:true", async () => {
		const { app, db } = await build_setup();
		await seed_package(db, "user_test", { id: "pipeline-package_del", name: "del" });

		const res = await delete_req(app, "/packages/pipeline-package_del", {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect((res.body.value as { deleted: boolean }).deleted).toBe(true);
	});

	test("returns 409 conflict when active runs exist", async () => {
		const { app, db } = await build_setup();
		await seed_package(db, "user_test", { id: "pipeline-package_busy", name: "busy" });
		await seed_run_row(db, "pipeline-package_busy", "pipeline-run_a");
		await seed_run_row(db, "pipeline-package_busy", "pipeline-run_b");

		const res = await delete_req(app, "/packages/pipeline-package_busy", {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(409);
		expect(res.body.error?.code).toBe("conflict");
		expect(res.body.error?.reason).toBe("active_runs");
		expect(res.body.error?.count).toBe(2);
	});

	test("returns 404 not_found for unknown id", async () => {
		const { app } = await build_setup();
		const res = await delete_req(app, "/packages/pipeline-package_missing", {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});
});
