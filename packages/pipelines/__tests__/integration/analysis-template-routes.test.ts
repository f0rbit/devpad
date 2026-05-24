/**
 * @module pipelines/__tests__/integration/analysis-template-routes
 *
 * Covers the admin-gated analysis-template CRUD surface added in
 * Phase 2.A:
 *
 * - `GET    /analysis-templates`       — list for an owner.
 * - `GET    /analysis-templates/:id`   — read one.
 * - `POST   /analysis-templates`       — create.
 * - `PATCH  /analysis-templates/:id`   — partial update.
 * - `DELETE /analysis-templates/:id`   — hard-delete.
 *
 * Auth model mirrors `/oidc-trust`: `Authorization: Bearer <PIPELINES_TOKEN>`
 * for admin identity. Writes (and reads) refuse a missing token with 401.
 * `validation_error` from the service (bad threshold DSL) maps to 400.
 */

import { describe, expect, test } from "bun:test";
import { pipeline_analysis_template } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Backend } from "@f0rbit/corpus";
import { create_memory_backend } from "@f0rbit/corpus";
import type { AuthError, AuthIdentity } from "../../src/auth.ts";
import { is_bearer_valid } from "../../src/auth.ts";
import { type AuthGate, make_routes, type PulseEmitterLite, type RoutesDeps } from "../../src/routes.ts";
import { create_test_db, seed_user } from "./helpers.ts";

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
		check: async request => {
			const header = request.headers.get("authorization");
			if (!is_bearer_valid(header, PIPELINES_TOKEN)) {
				return { ok: false as const, error: { code: "unauthorized" as const, message: "bad token" } satisfies AuthError };
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

type Envelope = { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> };

const get_req = async (app: ReturnType<typeof make_routes>, path: string, headers: Record<string, string> = {}) => {
	const res = await app.fetch(new Request(`http://run.local${path}`, { method: "GET", headers }));
	return { status: res.status, body: (await res.json()) as Envelope };
};

const post_json = async (app: ReturnType<typeof make_routes>, path: string, body: unknown, headers: Record<string, string> = {}) => {
	const res = await app.fetch(
		new Request(`http://run.local${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		})
	);
	return { status: res.status, body: (await res.json()) as Envelope };
};

const patch_json = async (app: ReturnType<typeof make_routes>, path: string, body: unknown, headers: Record<string, string> = {}) => {
	const res = await app.fetch(
		new Request(`http://run.local${path}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		})
	);
	return { status: res.status, body: (await res.json()) as Envelope };
};

const delete_req = async (app: ReturnType<typeof make_routes>, path: string, headers: Record<string, string> = {}) => {
	const res = await app.fetch(new Request(`http://run.local${path}`, { method: "DELETE", headers }));
	return { status: res.status, body: (await res.json()) as Envelope };
};

const valid_create_body = (overrides: Record<string, unknown> = {}) => ({
	owner_id: "user_test",
	name: "default-analysis",
	threshold_dsl: "error_rate < 0.01\np99_latency_ms > 500",
	window_ms: 600_000,
	...overrides,
});

describe("analysis-templates routes — happy-path lifecycle", () => {
	test("list-empty → create → list-1 → get → update → delete → list-empty", async () => {
		const { app, db } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };

		// 1. list returns []
		const list_initial = await get_req(app, "/analysis-templates?owner_id=user_test", auth);
		expect(list_initial.status).toBe(200);
		expect(list_initial.body.ok).toBe(true);
		expect(list_initial.body.value).toEqual([]);

		// 2. create
		const created = await post_json(app, "/analysis-templates", valid_create_body(), auth);
		expect(created.status).toBe(200);
		expect(created.body.ok).toBe(true);
		const created_row = created.body.value as { id: string; name: string };
		expect(created_row.name).toBe("default-analysis");
		const created_id = created_row.id;

		// Verify the row landed in D1
		const rows = await db.select().from(pipeline_analysis_template);
		expect(rows.some(r => r.id === created_id)).toBe(true);

		// 3. list returns [1]
		const list_after = await get_req(app, "/analysis-templates?owner_id=user_test", auth);
		expect(list_after.status).toBe(200);
		const list_after_value = list_after.body.value as Array<{ id: string }>;
		expect(Array.isArray(list_after_value)).toBe(true);
		expect(list_after_value).toHaveLength(1);
		expect(list_after_value[0].id).toBe(created_id);

		// 4. get
		const got = await get_req(app, `/analysis-templates/${created_id}?owner_id=user_test`, auth);
		expect(got.status).toBe(200);
		expect((got.body.value as { id: string }).id).toBe(created_id);

		// 5. update
		const updated = await patch_json(app, `/analysis-templates/${created_id}`, { owner_id: "user_test", name: "renamed" }, auth);
		expect(updated.status).toBe(200);
		expect((updated.body.value as { name: string }).name).toBe("renamed");

		// 6. delete
		const deleted = await delete_req(app, `/analysis-templates/${created_id}?owner_id=user_test`, auth);
		expect(deleted.status).toBe(200);
		expect((deleted.body.value as { deleted: boolean }).deleted).toBe(true);

		// 7. list returns []
		const list_final = await get_req(app, "/analysis-templates?owner_id=user_test", auth);
		expect(list_final.body.value).toEqual([]);
	});
});

describe("analysis-templates routes — auth", () => {
	test("GET /analysis-templates rejects missing auth with 401", async () => {
		const { app } = await build_setup();
		const res = await get_req(app, "/analysis-templates?owner_id=user_test");
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("unauthorized");
	});

	test("POST /analysis-templates rejects missing auth with 401", async () => {
		const { app } = await build_setup();
		const res = await post_json(app, "/analysis-templates", valid_create_body());
		expect(res.status).toBe(401);
	});

	test("PATCH /analysis-templates/:id rejects missing auth with 401", async () => {
		const { app } = await build_setup();
		const res = await patch_json(app, "/analysis-templates/x", { owner_id: "user_test", name: "y" });
		expect(res.status).toBe(401);
	});

	test("DELETE /analysis-templates/:id rejects missing auth with 401", async () => {
		const { app } = await build_setup();
		const res = await delete_req(app, "/analysis-templates/x?owner_id=user_test");
		expect(res.status).toBe(401);
	});
});

describe("analysis-templates routes — validation", () => {
	test("POST returns 400 invalid_body on malformed payload", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };
		const res = await post_json(app, "/analysis-templates", { name: "missing-fields" }, auth);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_body");
	});

	test("POST returns 400 validation_error when threshold_dsl is unparseable", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };
		const res = await post_json(app, "/analysis-templates", valid_create_body({ threshold_dsl: "garbage no op" }), auth);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("validation_error");
		expect(res.body.error?.field).toBe("threshold_dsl");
	});

	test("GET /analysis-templates returns 400 when owner_id missing", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };
		const res = await get_req(app, "/analysis-templates", auth);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_query");
	});
});

describe("analysis-templates routes — not_found semantics", () => {
	test("GET /analysis-templates/:id returns 404 for unknown id", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };
		const res = await get_req(app, "/analysis-templates/pipeline-analysis-template_missing?owner_id=user_test", auth);
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});

	test("PATCH /analysis-templates/:id returns 404 for unknown id", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };
		const res = await patch_json(app, "/analysis-templates/pipeline-analysis-template_missing", { owner_id: "user_test", name: "x" }, auth);
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});

	test("DELETE /analysis-templates/:id returns 404 for unknown id", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };
		const res = await delete_req(app, "/analysis-templates/pipeline-analysis-template_missing?owner_id=user_test", auth);
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});
});

describe("analysis-templates routes — list shape", () => {
	test("list response is an array, not { items: [...] }", async () => {
		const { app } = await build_setup();
		const auth = { authorization: auth_header(PIPELINES_TOKEN) };

		await post_json(app, "/analysis-templates", valid_create_body({ name: "a" }), auth);
		await post_json(app, "/analysis-templates", valid_create_body({ name: "b" }), auth);

		const list = await get_req(app, "/analysis-templates?owner_id=user_test", auth);
		expect(Array.isArray(list.body.value)).toBe(true);
		expect((list.body.value as Array<unknown>)).toHaveLength(2);
	});
});
