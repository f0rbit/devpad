/**
 * @module pipelines/__tests__/integration/oidc-trust-route
 *
 * Coverage for the admin-gated OIDC trust-policy management routes
 * added in Phase 15.D:
 *
 * - `GET    /oidc-trust?owner_id=...`
 * - `GET    /oidc-trust/:id?owner_id=...`
 * - `POST   /oidc-trust`
 * - `PATCH  /oidc-trust/:id`
 * - `DELETE /oidc-trust/:id?owner_id=...`
 *
 * Auth model mirrors `/packages` writes — bearer-gated. Once 15.B's
 * AuthIdentity lands, these will tighten to `identity.kind === "admin"`
 * explicitly (`@TODO(15.V)` marker in routes.ts).
 */

import { describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import type { Backend } from "@f0rbit/corpus";
import { create_memory_backend } from "@f0rbit/corpus";
import type { AuthError, AuthIdentity } from "../../src/auth.ts";
import { is_bearer_valid } from "../../src/auth.ts";
import { type AuthGate, make_routes, type PulseEmitterLite, type RoutesDeps } from "../../src/routes.ts";
import { create_test_db, seed_user } from "./helpers.ts";

// Test bearer abbreviated in logs per token-logging guidance — the
// literal value lives only in this file.
const PIPELINES_TOKEN = "test-admin-token-AAAAA";
const auth_header = (token: string) => `Bearer ${token}`;

type RouteSetup = {
	app: ReturnType<typeof make_routes>;
	db: Database;
	backend: Backend;
};

const build_setup = async (): Promise<RouteSetup> => {
	const db = create_test_db();
	await seed_user(db);
	await seed_user(db, "user_other");
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

const send_json = async (
	app: ReturnType<typeof make_routes>,
	method: "POST" | "PATCH",
	path: string,
	body: unknown,
	headers: Record<string, string> = {},
) => {
	const res = await app.fetch(
		new Request(`http://run.local${path}`, {
			method,
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
	return {
		status: res.status,
		body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> },
	};
};

const send_get = async (app: ReturnType<typeof make_routes>, path: string, headers: Record<string, string> = {}) => {
	const res = await app.fetch(new Request(`http://run.local${path}`, { method: "GET", headers }));
	return {
		status: res.status,
		body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> },
	};
};

const send_delete = async (app: ReturnType<typeof make_routes>, path: string, headers: Record<string, string> = {}) => {
	const res = await app.fetch(new Request(`http://run.local${path}`, { method: "DELETE", headers }));
	return {
		status: res.status,
		body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } & Record<string, unknown> },
	};
};

const valid_create_body = (overrides: Record<string, unknown> = {}) => ({
	owner_id: "user_test",
	github_owner: "f0rbit",
	expected_audience: "https://devpad-pipelines.dev-818.workers.dev",
	...overrides,
});

const create_policy = async (
	app: ReturnType<typeof make_routes>,
	body: Record<string, unknown> = {},
): Promise<string> => {
	const res = await send_json(app, "POST", "/oidc-trust", valid_create_body(body), {
		authorization: auth_header(PIPELINES_TOKEN),
	});
	expect(res.status).toBe(200);
	const value = res.body.value as { id: string };
	return value.id;
};

describe("POST /oidc-trust", () => {
	test("rejects missing auth with 401", async () => {
		const { app } = await build_setup();
		const res = await send_json(app, "POST", "/oidc-trust", valid_create_body());
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("unauthorized");
	});

	test("creates a policy with sensible defaults", async () => {
		const { app } = await build_setup();
		const res = await send_json(app, "POST", "/oidc-trust", valid_create_body(), {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		const created = res.body.value as {
			id: string;
			github_owner: string;
			repo_pattern: string;
			allowed_actions: string[];
		};
		expect(created.github_owner).toBe("f0rbit");
		expect(created.repo_pattern).toBe("*");
		expect(created.allowed_actions).toEqual(["artifacts:upload", "runs:start"]);
	});

	test("malformed body returns 400 invalid_body", async () => {
		const { app } = await build_setup();
		const res = await send_json(
			app,
			"POST",
			"/oidc-trust",
			{ owner_id: "user_test" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_body");
	});

	test("empty github_owner returns 400 validation", async () => {
		const { app } = await build_setup();
		const res = await send_json(app, "POST", "/oidc-trust", valid_create_body({ github_owner: "" }), {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(400);
	});
});

describe("GET /oidc-trust", () => {
	test("rejects missing auth with 401", async () => {
		const { app } = await build_setup();
		const res = await send_get(app, "/oidc-trust?owner_id=user_test");
		expect(res.status).toBe(401);
	});

	test("returns the caller's policies and excludes other owners'", async () => {
		const { app } = await build_setup();
		await create_policy(app, { github_owner: "mine-a" });
		await create_policy(app, { github_owner: "mine-b" });
		await create_policy(app, { owner_id: "user_other", github_owner: "theirs" });

		const res = await send_get(app, "/oidc-trust?owner_id=user_test", { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(200);
		const policies = res.body.value as Array<{ github_owner: string }>;
		expect(policies).toHaveLength(2);
		const owners = policies.map((p) => p.github_owner).sort();
		expect(owners).toEqual(["mine-a", "mine-b"]);
	});

	test("missing owner_id query returns 400 invalid_query", async () => {
		const { app } = await build_setup();
		const res = await send_get(app, "/oidc-trust", { authorization: auth_header(PIPELINES_TOKEN) });
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_query");
	});
});

describe("GET /oidc-trust/:id", () => {
	test("returns 404 for unknown id", async () => {
		const { app } = await build_setup();
		const res = await send_get(app, "/oidc-trust/pipeline-oidc-trust_missing?owner_id=user_test", {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});

	test("returns 404 when the policy belongs to another owner", async () => {
		const { app } = await build_setup();
		const id = await create_policy(app, { owner_id: "user_other" });

		const res = await send_get(app, `/oidc-trust/${id}?owner_id=user_test`, {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(404);
	});

	test("returns the policy on happy path", async () => {
		const { app } = await build_setup();
		const id = await create_policy(app);

		const res = await send_get(app, `/oidc-trust/${id}?owner_id=user_test`, {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(200);
		expect((res.body.value as { id: string }).id).toBe(id);
	});
});

describe("PATCH /oidc-trust/:id", () => {
	test("partial update only touches provided fields", async () => {
		const { app } = await build_setup();
		const id = await create_policy(app, { repo_pattern: "old-*" });

		const res = await send_json(
			app,
			"PATCH",
			`/oidc-trust/${id}`,
			{ owner_id: "user_test", repo_pattern: "new-*" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(res.status).toBe(200);
		const updated = res.body.value as { repo_pattern: string; github_owner: string };
		expect(updated.repo_pattern).toBe("new-*");
		expect(updated.github_owner).toBe("f0rbit");
	});

	test("returns 404 when patching another owner's policy", async () => {
		const { app } = await build_setup();
		const id = await create_policy(app, { owner_id: "user_other" });

		const res = await send_json(
			app,
			"PATCH",
			`/oidc-trust/${id}`,
			{ owner_id: "user_test", repo_pattern: "evil-*" },
			{ authorization: auth_header(PIPELINES_TOKEN) },
		);
		expect(res.status).toBe(404);
	});

	test("missing auth returns 401", async () => {
		const { app } = await build_setup();
		const res = await send_json(app, "PATCH", "/oidc-trust/anything", { owner_id: "user_test", repo_pattern: "x" });
		expect(res.status).toBe(401);
	});
});

describe("DELETE /oidc-trust/:id", () => {
	test("soft-deletes and disappears from list", async () => {
		const { app } = await build_setup();
		const id = await create_policy(app);

		const del = await send_delete(app, `/oidc-trust/${id}?owner_id=user_test`, {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(del.status).toBe(200);
		expect((del.body.value as { deleted: boolean }).deleted).toBe(true);

		const list = await send_get(app, "/oidc-trust?owner_id=user_test", { authorization: auth_header(PIPELINES_TOKEN) });
		expect((list.body.value as unknown[]).length).toBe(0);
	});

	test("404 for unknown id", async () => {
		const { app } = await build_setup();
		const res = await send_delete(app, "/oidc-trust/pipeline-oidc-trust_missing?owner_id=user_test", {
			authorization: auth_header(PIPELINES_TOKEN),
		});
		expect(res.status).toBe(404);
	});
});
