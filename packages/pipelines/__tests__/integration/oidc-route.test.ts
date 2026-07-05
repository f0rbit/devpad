/**
 * @module pipelines/__tests__/integration/oidc-route
 *
 * End-to-end coverage of `POST /auth/github-oidc` through the Hono app,
 * using in-memory verifier + signer fakes. The production wiring lives in
 * `src/providers/{oidc-verifier,session-signer}.ts` — that integration is
 * exercised here only at the contract boundary (the route adapter calls
 * `deps.oidc.verify_oidc` / `sign_session`).
 *
 * Tests never log the full session token; we assert structural shape
 * only (`.split('.').length === 3`, `length > 20`).
 */

import { describe, expect, test } from "bun:test";
import type { OidcSessionClaims, VerifiedOidcClaims } from "@devpad/core/services/pipelines";
import { pipeline_oidc_trust } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Backend, Result } from "@f0rbit/corpus";
import { create_memory_backend, err, ok } from "@f0rbit/corpus";
import { make_routes, type OidcDeps, type PulseEmitterLite, type RoutesDeps } from "../../src/routes";
import { create_test_db, seed_package, seed_user } from "./helpers";

const BASE_AUDIENCE = "https://devpad-pipelines.dev-818.workers.dev";

const make_fake_oidc_deps = (
	claims_by_jwt: Map<string, VerifiedOidcClaims>,
	opts: { sign_fails?: boolean } = {},
): OidcDeps & { signed: OidcSessionClaims[] } => {
	const signed: OidcSessionClaims[] = [];
	return {
		signed,
		verify_oidc: async (jwt) => {
			const claims = claims_by_jwt.get(jwt);
			if (claims === undefined) return err({ reason: "unknown jwt" });
			return ok(claims);
		},
		sign_session: async (claims) => {
			if (opts.sign_fails) return err({ reason: "OIDC_SESSION_SIGNING_KEY not bound on this Worker" });
			signed.push(claims);
			const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
			const payload = btoa(JSON.stringify(claims));
			return ok(`${header}.${payload}.sig`);
		},
		verify_session: async () => err({ reason: "not used in these tests" }),
	};
};

const seed_trust_policy = async (
	db: Database,
	owner_id: string,
	overrides: Partial<{
		id: string;
		github_owner: string;
		repo_pattern: string;
		allowed_refs: string[];
		expected_audience: string;
		allowed_actions: string[];
	}> = {},
): Promise<{ id: string }> => {
	const now = new Date().toISOString();
	const id = overrides.id ?? "pipeline-oidc-trust_test";
	await db.insert(pipeline_oidc_trust).values({
		id,
		owner_id,
		provider: "github",
		github_owner: overrides.github_owner ?? "f0rbit",
		repo_pattern: overrides.repo_pattern ?? "*",
		allowed_refs: (overrides.allowed_refs ?? []) as string[],
		allowed_environments: [] as string[],
		expected_audience: overrides.expected_audience ?? BASE_AUDIENCE,
		allowed_actions: (overrides.allowed_actions ?? ["artifacts:upload", "runs:start"]) as string[],
		session_ttl_seconds: 900,
		last_used_at: null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
	return { id };
};

type Setup = {
	app: ReturnType<typeof make_routes>;
	db: Database;
	backend: Backend;
	owner_id: string;
	oidc: ReturnType<typeof make_fake_oidc_deps>;
};

const build_setup = async (
	overrides: { sign_fails?: boolean; claims_by_jwt?: Map<string, VerifiedOidcClaims>; omit_oidc?: boolean } = {},
): Promise<Setup> => {
	const db = create_test_db();
	const u = await seed_user(db);
	const backend = create_memory_backend();
	const pulse: PulseEmitterLite = { emit: async () => undefined };
	const oidc = make_fake_oidc_deps(overrides.claims_by_jwt ?? new Map(), { sign_fails: overrides.sign_fails });
	const deps: RoutesDeps = {
		db,
		do_router: { get: () => ({ fetch: async () => new Response("", { status: 500 }) }) },
		manifests: { get: async () => null },
		templates: { resolve: async () => null },
		lineage: { previous: async () => null },
		backend,
		pulse,
		oidc: overrides.omit_oidc ? undefined : oidc,
	};
	return { app: make_routes(() => deps), db, backend, owner_id: u.id, oidc };
};

const make_branch_claims = (overrides: Partial<VerifiedOidcClaims> = {}): VerifiedOidcClaims => ({
	iss: "https://token.actions.githubusercontent.com",
	aud: BASE_AUDIENCE,
	exp: Math.floor(Date.now() / 1000) + 60,
	iat: Math.floor(Date.now() / 1000),
	sub: "repo:f0rbit/my-pkg:ref:refs/heads/main",
	repository: "f0rbit/my-pkg",
	repository_owner: "f0rbit",
	ref: "refs/heads/main",
	sha: "abc1234",
	run_id: "12345",
	actor: "f0rbit",
	...overrides,
});

const post_oidc = async (app: ReturnType<typeof make_routes>, body: unknown) => {
	const res = await app.fetch(
		new Request("http://run.local/auth/github-oidc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	return {
		status: res.status,
		body: (await res.json()) as {
			ok: boolean;
			value?: Record<string, unknown>;
			error?: { code: string } & Record<string, unknown>;
		},
	};
};

describe("POST /auth/github-oidc — happy path", () => {
	test("200 with session token, expires_at, scope, package_ids", async () => {
		const claims = make_branch_claims();
		const setup = await build_setup({ claims_by_jwt: new Map([["good_jwt", claims]]) });
		await seed_trust_policy(setup.db, setup.owner_id);
		await seed_package(setup.db, setup.owner_id, {
			id: "pipeline-package_my-pkg",
			name: "my-pkg",
			repo_url: "https://github.com/f0rbit/my-pkg",
		});

		const res = await post_oidc(setup.app, { jwt: "good_jwt", package_id: "pipeline-package_my-pkg" });
		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		const value = res.body.value as {
			session_token: string;
			expires_at: string;
			scope: string[];
			package_ids: string[];
			trust_policy_id: string;
		};
		// Token shape only — NEVER log the actual value
		expect(value.session_token.split(".")).toHaveLength(3);
		expect(value.session_token.length).toBeGreaterThan(20);
		expect(value.scope).toEqual(["artifacts:upload", "runs:start"]);
		expect(value.package_ids).toEqual(["pipeline-package_my-pkg"]);
		expect(typeof value.expires_at).toBe("string");
		expect(value.trust_policy_id).toBe("pipeline-oidc-trust_test");
	});

	test("emits a pulse event on successful exchange", async () => {
		const claims = make_branch_claims();
		const setup = await build_setup({ claims_by_jwt: new Map([["good_jwt", claims]]) });
		const events: Array<{ event: string } & Record<string, unknown>> = [];
		const pulse: PulseEmitterLite = {
			emit: async (event) => {
				events.push(event);
				return undefined;
			},
		};
		// rebuild deps with capturing pulse
		const deps: RoutesDeps = {
			db: setup.db,
			do_router: { get: () => ({ fetch: async () => new Response("", { status: 500 }) }) },
			manifests: { get: async () => null },
			templates: { resolve: async () => null },
			lineage: { previous: async () => null },
			backend: setup.backend,
			pulse,
			oidc: setup.oidc,
		};
		const app = make_routes(() => deps);
		await seed_trust_policy(setup.db, setup.owner_id);
		await seed_package(setup.db, setup.owner_id, {
			id: "pipeline-package_my-pkg",
			name: "my-pkg",
			repo_url: "https://github.com/f0rbit/my-pkg",
		});

		await post_oidc(app, { jwt: "good_jwt", package_id: "pipeline-package_my-pkg" });
		const oidc_events = events.filter((e) => e.event === "oidc_exchange");
		expect(oidc_events).toHaveLength(1);
		expect(oidc_events[0].status).toBe("ok");
		expect(oidc_events[0].package_id).toBe("pipeline-package_my-pkg");
	});
});

describe("POST /auth/github-oidc — error mapping", () => {
	test("400 invalid_request when jwt is missing", async () => {
		const setup = await build_setup();
		const res = await post_oidc(setup.app, { package_id: "x" });
		expect(res.status).toBe(400);
		expect(res.body.error?.code).toBe("invalid_request");
	});

	test("400 invalid_request when body is malformed JSON", async () => {
		const setup = await build_setup();
		const res = await setup.app.fetch(
			new Request("http://run.local/auth/github-oidc", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "not-json{{{",
			}),
		);
		expect(res.status).toBe(400);
		const json = (await res.json()) as { ok: boolean; error?: { code: string } };
		expect(json.error?.code).toBe("invalid_request");
	});

	test("401 invalid_oidc_token for forged jwt", async () => {
		const setup = await build_setup({ claims_by_jwt: new Map() });
		await seed_trust_policy(setup.db, setup.owner_id);

		const res = await post_oidc(setup.app, { jwt: "forged_jwt" });
		expect(res.status).toBe(401);
		expect(res.body.error?.code).toBe("invalid_oidc_token");
	});

	test("403 trust_policy_failed when no matching policy", async () => {
		const claims = make_branch_claims({
			repository_owner: "f0rbit",
			repository: "f0rbit/orphan-pkg",
			sub: "repo:f0rbit/orphan-pkg:ref:refs/heads/main",
		});
		const setup = await build_setup({ claims_by_jwt: new Map([["good_jwt", claims]]) });
		// policy is restricted to forbit-* prefix
		await seed_trust_policy(setup.db, setup.owner_id, { repo_pattern: "forbit-*" });

		const res = await post_oidc(setup.app, { jwt: "good_jwt" });
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("trust_policy_failed");
	});

	test("404 package_not_found when package_id unknown", async () => {
		const claims = make_branch_claims();
		const setup = await build_setup({ claims_by_jwt: new Map([["good_jwt", claims]]) });
		await seed_trust_policy(setup.db, setup.owner_id);

		const res = await post_oidc(setup.app, { jwt: "good_jwt", package_id: "pipeline-package_missing" });
		expect(res.status).toBe(404);
		expect(res.body.error?.code).toBe("package_not_found");
	});

	test("403 package_scope_mismatch when repo_url disagrees with claim", async () => {
		const claims = make_branch_claims();
		const setup = await build_setup({ claims_by_jwt: new Map([["good_jwt", claims]]) });
		await seed_trust_policy(setup.db, setup.owner_id);
		await seed_package(setup.db, setup.owner_id, {
			id: "pipeline-package_wrong",
			name: "wrong",
			repo_url: "https://github.com/other-org/wrong",
		});

		const res = await post_oidc(setup.app, { jwt: "good_jwt", package_id: "pipeline-package_wrong" });
		expect(res.status).toBe(403);
		expect(res.body.error?.code).toBe("package_scope_mismatch");
		expect(res.body.error?.claimed_repo).toBe("f0rbit/my-pkg");
		expect(res.body.error?.declared_repo).toBe("other-org/wrong");
	});

	test("503 auth_unavailable when OIDC deps not wired", async () => {
		const setup = await build_setup({ omit_oidc: true });
		const res = await post_oidc(setup.app, { jwt: "any" });
		expect(res.status).toBe(503);
		expect(res.body.error?.code).toBe("auth_unavailable");
	});

	test("503 auth_unavailable when signing key missing (sign_session fails)", async () => {
		const claims = make_branch_claims();
		const setup = await build_setup({ claims_by_jwt: new Map([["good_jwt", claims]]), sign_fails: true });
		await seed_trust_policy(setup.db, setup.owner_id);
		await seed_package(setup.db, setup.owner_id, {
			id: "pipeline-package_my-pkg",
			name: "my-pkg",
			repo_url: "https://github.com/f0rbit/my-pkg",
		});

		const res = await post_oidc(setup.app, { jwt: "good_jwt", package_id: "pipeline-package_my-pkg" });
		expect(res.status).toBe(503);
		expect(res.body.error?.code).toBe("auth_unavailable");
	});
});
