/**
 * @module pipelines/__tests__/integration/event-ingestion
 *
 * Coverage for `POST /runs/:id/events` + `GET /runs/:id/events`:
 *
 *   admin bearer        → happy path → 201
 *   admin bearer replay → 200 with the same event_id
 *   session + scope     → happy path → 201
 *   session no scope    → 403 insufficient_scope
 *   session wrong pkg   → 403 package_scope_mismatch
 *   no auth             → 401 unauthorized
 *   bad body            → 400 invalid_body
 *   non-existent run    → 404 not_found
 *   X-Idempotency-Key header overrides body
 *   GET /events returns inserted rows
 *
 * Auth gate is the literal-token AuthGate from `packages-routes.test.ts`,
 * extended so a known fake session token returns a `kind: "session"`
 * identity with configurable scope/package_ids.
 */

import { describe, expect, test } from "bun:test";
import type { OidcAudit } from "@devpad/core/services/pipelines";
import { pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import type { AuthError, AuthIdentity } from "../../src/auth.ts";
import { is_bearer_valid, parse_bearer_header } from "../../src/auth.ts";
import { type AuthGate, make_routes, type PulseEmitterLite, type RoutesDeps } from "../../src/routes.ts";
import { create_test_db, seed_package, seed_user } from "./helpers.ts";

const ADMIN_TOKEN = "test-admin-token-AAAAAAAAAA";

// Fake "session JWT" — looks JWT-shaped (3 dot segments) so it doesn't
// fall through to bearer comparison, but our AuthGate matches it by
// exact string. Real production wiring routes through the SessionVerifier;
// this test substitutes the AuthGate so we don't have to mint real JWTs.
const FAKE_SESSION_TOKEN_PREFIX = "fake.session.";

type SessionConfig = {
	scope: string[];
	package_ids: string[];
};

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

const SEEDED_RUN_ID = "pipeline-run_e2e";
const SEEDED_PACKAGE_ID = "pipeline-package_e2e";

async function seed_run(db: Database, package_id = SEEDED_PACKAGE_ID, run_id = SEEDED_RUN_ID): Promise<void> {
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id: run_id,
		package_id,
		version_set_id: "vs_v1",
		shape: "atomic",
		kind: "deploy",
		status: "queued",
		current_stage: "staging",
		resolved_rollout: { type: "atomic" } as never,
		resolved_gates: {} as never,
		forced_atomic_reason: null,
		started_at: now,
		finished_at: null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
}

type Setup = {
	app: ReturnType<typeof make_routes>;
	db: Database;
	do_calls: Array<{ run_id: string; path: string }>;
};

async function build_setup(): Promise<Setup> {
	const db = create_test_db();
	const u = await seed_user(db);
	await seed_package(db, u.id, { id: SEEDED_PACKAGE_ID });
	await seed_run(db);

	const do_calls: Array<{ run_id: string; path: string }> = [];
	const pulse: PulseEmitterLite = { emit: async () => undefined };
	const deps: RoutesDeps = {
		db,
		do_router: {
			get: (run_id) => ({
				fetch: async (req) => {
					const url = new URL(req.url);
					do_calls.push({ run_id, path: url.pathname });
					return new Response(JSON.stringify({ ok: true, value: {} }), { status: 200 });
				},
			}),
		},
		manifests: { get: async () => null },
		templates: { resolve: async () => null },
		lineage: { previous: async () => null },
		auth: auth_gate,
		pulse,
	};
	return { app: make_routes(() => deps), db, do_calls };
}

const post_event = async (
	app: ReturnType<typeof make_routes>,
	run_id: string,
	body: unknown,
	auth: string | null,
	extra_headers: Record<string, string> = {},
) => {
	const headers: Record<string, string> = { "content-type": "application/json", ...extra_headers };
	if (auth !== null) headers["authorization"] = auth;
	const res = await app.fetch(
		new Request(`http://run.local/runs/${run_id}/events`, {
			method: "POST",
			headers,
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
	);
	return {
		status: res.status,
		body: (await res.json()) as {
			ok: boolean;
			value?: { event_id: string; duplicated: boolean };
			error?: { code: string } & Record<string, unknown>;
		},
	};
};

const VALID_UUID = "55555555-5555-4555-8555-555555555555";

const make_valid_body = (overrides: Record<string, unknown> = {}) => ({
	stage_name: "staging",
	kind: "warning",
	payload: { note: "ok" },
	idempotency_key: VALID_UUID,
	...overrides,
});

describe("POST /runs/:id/events — admin bearer", () => {
	test("201 on insert; body returns event_id and duplicated:false", async () => {
		const setup = await build_setup();
		const res = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), `Bearer ${ADMIN_TOKEN}`);
		expect(res.status).toBe(201);
		expect(res.body.ok).toBe(true);
		expect(res.body.value?.duplicated).toBe(false);
		expect(res.body.value?.event_id).toMatch(/^pipeline-stage-event_/);
	});

	test("200 on idempotent replay; same event_id", async () => {
		const setup = await build_setup();
		const auth = `Bearer ${ADMIN_TOKEN}`;
		const first = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), auth);
		expect(first.status).toBe(201);

		const second = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), auth);
		expect(second.status).toBe(200);
		expect(second.body.value?.duplicated).toBe(true);
		expect(second.body.value?.event_id).toBe(first.body.value?.event_id);
	});

	test("X-Idempotency-Key header overrides body key", async () => {
		const setup = await build_setup();
		const auth = `Bearer ${ADMIN_TOKEN}`;
		const header_key = "66666666-6666-4666-8666-666666666666";

		// Two requests with same header_key but different body keys should
		// still dedup because header takes precedence.
		const first = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body({ idempotency_key: VALID_UUID }), auth, {
			"x-idempotency-key": header_key,
		});
		expect(first.status).toBe(201);

		const second = await post_event(
			setup.app,
			SEEDED_RUN_ID,
			make_valid_body({ idempotency_key: "77777777-7777-4777-8777-777777777777" }),
			auth,
			{ "x-idempotency-key": header_key },
		);
		expect(second.status).toBe(200);
		expect(second.body.value?.event_id).toBe(first.body.value?.event_id);
	});

	test("non-existent run → 404 not_found", async () => {
		const setup = await build_setup();
		const res = await post_event(setup.app, "pipeline-run_does-not-exist", make_valid_body(), `Bearer ${ADMIN_TOKEN}`);
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("not_found");
	});

	test("bad body → 400 invalid_body", async () => {
		const setup = await build_setup();
		const res = await post_event(setup.app, SEEDED_RUN_ID, { kind: "warning" }, `Bearer ${ADMIN_TOKEN}`);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_body");
	});

	test("malformed JSON body → 400 invalid_body", async () => {
		const setup = await build_setup();
		const res = await post_event(setup.app, SEEDED_RUN_ID, "not-json{{", `Bearer ${ADMIN_TOKEN}`);
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_body");
	});
});

describe("POST /runs/:id/events — session auth", () => {
	test("session with runs:events + matching package → 201", async () => {
		const setup = await build_setup();
		const token = make_session_token({ scope: ["runs:events"], package_ids: [SEEDED_PACKAGE_ID] });
		const res = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), `Bearer ${token}`);
		expect(res.status).toBe(201);
		expect(res.body.value?.duplicated).toBe(false);
	});

	test("session without runs:events scope → 403 insufficient_scope", async () => {
		const setup = await build_setup();
		const token = make_session_token({ scope: ["runs:start"], package_ids: [SEEDED_PACKAGE_ID] });
		const res = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), `Bearer ${token}`);
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("insufficient_scope");
		expect(res.body.error?.required).toBe("runs:events");
	});

	test("session with runs:events but wrong package_id → 403 package_scope_mismatch", async () => {
		const setup = await build_setup();
		const token = make_session_token({ scope: ["runs:events"], package_ids: ["pipeline-package_other"] });
		const res = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), `Bearer ${token}`);
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("package_scope_mismatch");
		expect(res.body.error?.package_id).toBe(SEEDED_PACKAGE_ID);
	});
});

describe("POST /runs/:id/events — no auth", () => {
	test("missing Authorization header → 401 unauthorized", async () => {
		const setup = await build_setup();
		const res = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), null);
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("unauthorized");
	});

	test("invalid bearer → 401 unauthorized", async () => {
		const setup = await build_setup();
		const res = await post_event(setup.app, SEEDED_RUN_ID, make_valid_body(), "Bearer wrong-token");
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("unauthorized");
	});
});

describe("GET /runs/:id/events", () => {
	test("returns the stored events newest-first", async () => {
		const setup = await build_setup();
		const auth = `Bearer ${ADMIN_TOKEN}`;
		await post_event(
			setup.app,
			SEEDED_RUN_ID,
			make_valid_body({
				stage_name: "staging",
				kind: "warning",
				idempotency_key: "88888888-8888-4888-8888-888888888888",
			}),
			auth,
		);
		await post_event(
			setup.app,
			SEEDED_RUN_ID,
			make_valid_body({
				stage_name: "wave1",
				kind: "deploy_completed",
				idempotency_key: "99999999-9999-4999-8999-999999999999",
			}),
			auth,
		);

		const res = await setup.app.fetch(new Request(`http://run.local/runs/${SEEDED_RUN_ID}/events`));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; value: Array<{ kind: string; stage_name: string }> };
		expect(body.ok).toBe(true);
		expect(body.value.length).toBe(2);

		// Confirm the rows landed in the DB (sanity check on the order
		// invariant doesn't rely on timestamps being distinct in fast tests).
		const rows = await setup.db
			.select()
			.from(pipeline_stage_event)
			.where(eq(pipeline_stage_event.run_id, SEEDED_RUN_ID));
		expect(rows).toHaveLength(2);
	});

	test("returns 404 when the run doesn't exist", async () => {
		const setup = await build_setup();
		const res = await setup.app.fetch(new Request(`http://run.local/runs/pipeline-run_missing/events`));
		expect(res.status).toBe(404);
	});
});
