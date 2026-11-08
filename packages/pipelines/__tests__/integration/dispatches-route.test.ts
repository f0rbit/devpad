/**
 * @module pipelines/__tests__/integration/dispatches-route
 *
 * Coverage for `GET /runs/:id/dispatches` (external deploy mode #155):
 *
 *   admin bearer      → 200 with the envelope
 *   session + scope   → 200 (CI holds `runs:events` + package)
 *   session no scope  → 403 insufficient_scope
 *   session wrong pkg → 403 package_scope_mismatch
 *   no auth           → 401 unauthorized
 *   non-existent run  → 404 not_found
 *
 * Envelope shape asserted: `{ ok, value: { run_id, run_status,
 * commit_sha, dispatches: [...] } }` with per-row
 * `{ stage_name, commit_sha, status, error, requested_by, created_at,
 * updated_at }`.
 */

import { describe, expect, test } from "bun:test";
import type { OidcAudit } from "@devpad/core/services/pipelines";
import { pipeline_dispatch, pipeline_run } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { AuthError, AuthIdentity } from "../../src/auth";
import { is_bearer_valid, parse_bearer_header } from "../../src/auth";
import { type AuthGate, make_routes, type RoutesDeps } from "../../src/routes";
import { create_test_db, seed_package, seed_user } from "./helpers";

const ADMIN_TOKEN = "test-admin-token-DISPATCHED";

const FAKE_SESSION_TOKEN_PREFIX = "fake.session.";

type SessionConfig = { scope: string[]; package_ids: string[] };

const SESSIONS = new Map<string, SessionConfig>();

const make_session_token = (cfg: SessionConfig): string => {
	const tok = `${FAKE_SESSION_TOKEN_PREFIX}${crypto.randomUUID()}`;
	SESSIONS.set(tok, cfg);
	return tok;
};

const auth_gate: AuthGate<AuthIdentity> = {
	check: async (request) => {
		const header = request.headers.get("authorization");
		const token = parse_bearer_header(header);
		if (token === null) {
			return { ok: false as const, error: { code: "unauthorized" as const, message: "no bearer" } satisfies AuthError };
		}
		const session = SESSIONS.get(token);
		if (session !== undefined) {
			const oidc: OidcAudit = {
				sub: "test:sub",
				repository: "f0rbit/pkg",
				ref: null,
				sha: null,
				run_id: null,
				actor: null,
			};
			return {
				ok: true as const,
				value: {
					kind: "session" as const,
					scope: session.scope,
					package_ids: session.package_ids,
					trust_policy_id: "tp-test",
					oidc,
				},
			};
		}
		if (is_bearer_valid(header, ADMIN_TOKEN)) {
			return { ok: true as const, value: { kind: "admin" as const, reason: "pipelines_token" as const } };
		}
		return { ok: false as const, error: { code: "unauthorized" as const, message: "bad token" } satisfies AuthError };
	},
};

const SEEDED_RUN_ID = "pipeline-run_dispatch";
const SEEDED_PACKAGE_ID = "pipeline-package_dispatch";
const COMMIT_A = "a".repeat(40);

async function seed_run(db: Database): Promise<void> {
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id: SEEDED_RUN_ID,
		package_id: SEEDED_PACKAGE_ID,
		version_set_id: null,
		commit_sha: COMMIT_A,
		shape: "atomic",
		kind: "deploy",
		status: "deploying",
		current_stage: "production",
		resolved_rollout: { type: "atomic" },
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
}

async function seed_dispatch(
	db: Database,
	row: Partial<typeof pipeline_dispatch.$inferInsert> & { run_id: string; stage_name: string },
): Promise<void> {
	const now = new Date().toISOString();
	await db.insert(pipeline_dispatch).values({
		id: `pipeline-dispatch_${crypto.randomUUID()}`,
		commit_sha: COMMIT_A,
		status: "dispatched",
		error: null,
		requested_by: "user_test",
		created_at: now,
		updated_at: now,
		...row,
	});
}

type Setup = { app: ReturnType<typeof make_routes>; db: Database };

async function build_setup(): Promise<Setup> {
	const db = create_test_db();
	const u = await seed_user(db);
	await seed_package(db, u.id, { id: SEEDED_PACKAGE_ID });
	await seed_run(db);
	await seed_dispatch(db, { run_id: SEEDED_RUN_ID, stage_name: "production" });
	await seed_dispatch(db, { run_id: SEEDED_RUN_ID, stage_name: "staging", status: "claimed" });

	const deps: RoutesDeps = {
		db,
		do_router: { get: () => ({ fetch: async () => new Response("", { status: 204 }) }) },
		manifests: { get: async () => null },
		templates: { resolve: async () => null },
		lineage: { previous: async () => null },
		auth: auth_gate,
	};
	return { app: make_routes(() => deps), db };
}

type DispatchEnvelope = {
	ok: boolean;
	value?: {
		run_id: string;
		run_status: string;
		commit_sha: string | null;
		dispatches: Array<{
			stage_name: string;
			commit_sha: string;
			status: string;
			error: string | null;
			requested_by: string | null;
			created_at: string;
			updated_at: string;
		}>;
	};
	error?: { code: string } & Record<string, unknown>;
};

const get_dispatches = async (app: ReturnType<typeof make_routes>, run_id: string, auth: string | null) => {
	const headers: Record<string, string> = {};
	if (auth !== null) headers["authorization"] = auth;
	const res = await app.fetch(new Request(`http://run.local/runs/${run_id}/dispatches`, { headers }));
	const raw_body: unknown = await res.json();
	return { status: res.status, body: raw_body as DispatchEnvelope };
};

describe("GET /runs/:id/dispatches — admin bearer", () => {
	test("200 with envelope: run fields + all dispatch rows", async () => {
		const setup = await build_setup();
		const res = await get_dispatches(setup.app, SEEDED_RUN_ID, `Bearer ${ADMIN_TOKEN}`);
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		const value = res.body.value;
		expect(value?.run_id).toBe(SEEDED_RUN_ID);
		expect(value?.run_status).toBe("deploying");
		expect(value?.commit_sha).toBe(COMMIT_A);
		expect(value?.dispatches).toHaveLength(2);
		const production = value?.dispatches.find((d) => d.stage_name === "production");
		expect(production?.status).toBe("dispatched");
		expect(production?.commit_sha).toBe(COMMIT_A);
		expect(production?.requested_by).toBe("user_test");
		expect(production?.error).toBeNull();
		expect(production?.created_at).toEqual(production?.updated_at);
		const staging = value?.dispatches.find((d) => d.stage_name === "staging");
		expect(staging?.status).toBe("claimed");
	});
});

describe("GET /runs/:id/dispatches — session auth", () => {
	test("session with runs:events + matching package → 200", async () => {
		const setup = await build_setup();
		const token = make_session_token({ scope: ["runs:events"], package_ids: [SEEDED_PACKAGE_ID] });
		const res = await get_dispatches(setup.app, SEEDED_RUN_ID, `Bearer ${token}`);
		expect(res.status).toBe(200);
		expect(res.body.value?.dispatches).toHaveLength(2);
	});

	test("session without runs:events scope → 403 insufficient_scope", async () => {
		const setup = await build_setup();
		const token = make_session_token({ scope: ["runs:start"], package_ids: [SEEDED_PACKAGE_ID] });
		const res = await get_dispatches(setup.app, SEEDED_RUN_ID, `Bearer ${token}`);
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("insufficient_scope");
		expect(res.body.error?.required).toBe("runs:events");
	});

	test("session with runs:events but wrong package → 403 package_scope_mismatch", async () => {
		const setup = await build_setup();
		const token = make_session_token({ scope: ["runs:events"], package_ids: ["pipeline-package_other"] });
		const res = await get_dispatches(setup.app, SEEDED_RUN_ID, `Bearer ${token}`);
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("package_scope_mismatch");
		expect(res.body.error?.package_id).toBe(SEEDED_PACKAGE_ID);
	});
});

describe("GET /runs/:id/dispatches — no auth", () => {
	test("missing Authorization header → 401 unauthorized", async () => {
		const setup = await build_setup();
		const res = await get_dispatches(setup.app, SEEDED_RUN_ID, null);
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("unauthorized");
	});

	test("invalid bearer → 401 unauthorized", async () => {
		const setup = await build_setup();
		const res = await get_dispatches(setup.app, SEEDED_RUN_ID, "Bearer wrong-token");
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("unauthorized");
	});
});

describe("GET /runs/:id/dispatches — not found", () => {
	test("non-existent run → 404 not_found", async () => {
		const setup = await build_setup();
		const res = await get_dispatches(setup.app, "pipeline-run_does-not-exist", `Bearer ${ADMIN_TOKEN}`);
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});
});
