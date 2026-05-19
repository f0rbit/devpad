/**
 * @module core/services/pipelines/__tests__/integration/oidc
 *
 * Integration tests for the OIDC exchange service using an in-memory
 * verifier + signer + DB. No real `jose`, no real RSA. The production
 * adapter lives in `@devpad/pipelines/providers/oidc-verifier.ts` and
 * `session-signer.ts` and is exercised end-to-end in
 * `packages/pipelines/__tests__/integration/oidc-route.test.ts`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { OidcSessionClaims, VerifiedOidcClaims } from "@devpad/core/services/pipelines";
import { exchange_oidc_for_session, match_trust_policy } from "@devpad/core/services/pipelines";
import { pipeline_oidc_trust } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { create_test_db, seed_package, seed_user } from "./helpers.js";

// ─── Fakes ──────────────────────────────────────────────────────────

const make_fake_verifier = (claims_by_jwt: Map<string, VerifiedOidcClaims>) => ({
	verify: async (jwt: string): Promise<Result<VerifiedOidcClaims, { reason: string }>> => {
		const claims = claims_by_jwt.get(jwt);
		if (claims === undefined) return err({ reason: `unknown jwt token: ${jwt.slice(0, 8)}...` });
		return ok(claims);
	},
});

const make_fake_signer = (): { sign: (c: OidcSessionClaims) => Promise<Result<string, { reason: string }>>; signed: OidcSessionClaims[] } => {
	const signed: OidcSessionClaims[] = [];
	return {
		signed,
		sign: async (claims: OidcSessionClaims): Promise<Result<string, { reason: string }>> => {
			signed.push(claims);
			// Produce a deterministic three-segment "JWT" so route tests can
			// assert shape without ever logging the value.
			const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
			const payload = btoa(JSON.stringify(claims));
			const sig = btoa("fake-signature");
			return ok(`${header}.${payload}.${sig}`);
		},
	};
};

const make_clock = (start: Date = new Date("2026-05-19T00:00:00Z")): { now: () => Date; advance: (ms: number) => void } => {
	let current = start;
	return {
		now: () => current,
		advance: ms => {
			current = new Date(current.getTime() + ms);
		},
	};
};

let jti_counter = 0;
const next_jti = (): string => `jti_${++jti_counter}`;

const BASE_AUDIENCE = "https://devpad-pipelines.dev-818.workers.dev";

// ─── Seed helpers ───────────────────────────────────────────────────

const seed_trust_policy = async (
	db: Database,
	owner_id: string,
	overrides: Partial<{
		id: string;
		github_owner: string;
		repo_pattern: string;
		allowed_refs: string[];
		allowed_environments: string[];
		expected_audience: string;
		allowed_actions: string[];
		session_ttl_seconds: number;
		created_at: string;
	}> = {}
): Promise<{ id: string }> => {
	const now = overrides.created_at ?? new Date().toISOString();
	const id = overrides.id ?? `pipeline-oidc-trust_${Math.random().toString(36).slice(2, 8)}`;
	await db.insert(pipeline_oidc_trust).values({
		id,
		owner_id,
		provider: "github",
		github_owner: overrides.github_owner ?? "f0rbit",
		repo_pattern: overrides.repo_pattern ?? "*",
		allowed_refs: overrides.allowed_refs ?? ([] as string[]),
		allowed_environments: overrides.allowed_environments ?? ([] as string[]),
		expected_audience: overrides.expected_audience ?? BASE_AUDIENCE,
		allowed_actions: overrides.allowed_actions ?? (["artifacts:upload", "runs:start"] as string[]),
		session_ttl_seconds: overrides.session_ttl_seconds ?? 900,
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
	run_id: "987654321",
	actor: "f0rbit",
	workflow: "deploy",
	event_name: "push",
	...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("exchange_oidc_for_session — happy path", () => {
	let db: Database;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		owner_id = u.id;
		await seed_package(db, owner_id, { id: "pipeline-package_my-pkg", name: "my-pkg", repo_url: "https://github.com/f0rbit/my-pkg" });
	});

	test("mints a session for a matching policy + valid package", async () => {
		const policy = await seed_trust_policy(db, owner_id);
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const clock = make_clock();

		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: clock.now, new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.trust_policy_id).toBe(policy.id);
		expect(result.value.package_ids).toEqual(["pipeline-package_my-pkg"]);
		expect(result.value.scope).toEqual(["artifacts:upload", "runs:start"]);
		// Token shape only — never log the full value
		expect(result.value.session_token.split(".")).toHaveLength(3);
		expect(result.value.session_token.length).toBeGreaterThan(20);
		expect(result.value.expires_at.getTime()).toBeGreaterThan(clock.now().getTime());

		expect(signer.signed).toHaveLength(1);
		expect(signer.signed[0].sub).toBe("package:pipeline-package_my-pkg");
		expect(signer.signed[0].oidc.repository).toBe("f0rbit/my-pkg");
		expect(signer.signed[0].oidc.ref).toBe("refs/heads/main");
	});

	test("touches last_used_at on the matched policy", async () => {
		const policy = await seed_trust_policy(db, owner_id);
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const clock = make_clock();

		await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: clock.now, new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);

		const rows = await db.select().from(pipeline_oidc_trust);
		const row = rows.find(r => r.id === policy.id);
		expect(row?.last_used_at).toBe(clock.now().toISOString());
	});

	test("session sub falls back to owner when no package_id supplied", async () => {
		await seed_trust_policy(db, owner_id);
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();

		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a" }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.package_ids).toEqual([]);
		expect(signer.signed[0].sub).toBe(`owner:${owner_id}`);
	});

	test("first-match-wins for multiple policies (created_at DESC ordering)", async () => {
		const t_old = "2026-01-01T00:00:00Z";
		const t_new = "2026-05-01T00:00:00Z";
		// Older one is permissive; newer one tightens to main
		await seed_trust_policy(db, owner_id, { id: "policy_old", repo_pattern: "*", allowed_refs: [], created_at: t_old, allowed_actions: ["artifacts:upload"] });
		await seed_trust_policy(db, owner_id, { id: "policy_new", repo_pattern: "*", allowed_refs: ["refs/heads/main"], created_at: t_new, allowed_actions: ["artifacts:upload", "runs:start"] });

		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();

		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.trust_policy_id).toBe("policy_new");
		expect(result.value.scope).toEqual(["artifacts:upload", "runs:start"]);
	});

	test("requested_scope intersects with policy.allowed_actions", async () => {
		await seed_trust_policy(db, owner_id);
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();

		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg", requested_scope: ["artifacts:upload"] }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.scope).toEqual(["artifacts:upload"]);
	});

	test("requested_scope items unknown to OIDC_SESSION_SCOPES are dropped", async () => {
		await seed_trust_policy(db, owner_id);
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();

		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg", requested_scope: ["artifacts:upload", "unknown:scope"] }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.scope).toEqual(["artifacts:upload"]);
	});
});

describe("exchange_oidc_for_session — invalid_oidc_token", () => {
	let db: Database;
	let owner_id: string;
	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		owner_id = u.id;
		await seed_package(db, owner_id, { id: "pipeline-package_my-pkg", name: "my-pkg", repo_url: "https://github.com/f0rbit/my-pkg" });
		await seed_trust_policy(db, owner_id);
	});

	test("forged / unknown jwt fails verification", async () => {
		const verifier = make_fake_verifier(new Map());
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_unknown", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_oidc_token");
	});

	test("sub repository disagrees with `repository` claim — rejected", async () => {
		const claims = make_branch_claims({ sub: "repo:other-org/different-repo:ref:refs/heads/main" });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_oidc_token");
	});

	test("empty jwt returns invalid_request", async () => {
		const verifier = make_fake_verifier(new Map());
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("invalid_request");
	});
});

describe("exchange_oidc_for_session — trust_policy_failed", () => {
	let db: Database;
	let owner_id: string;
	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		owner_id = u.id;
		await seed_package(db, owner_id, { id: "pipeline-package_my-pkg", name: "my-pkg", repo_url: "https://github.com/f0rbit/my-pkg" });
	});

	test("no policies configured", async () => {
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("trust_policy_failed");
	});

	test("owner mismatch", async () => {
		await seed_trust_policy(db, owner_id, { github_owner: "someone-else" });
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("trust_policy_failed");
	});

	test("repo_pattern mismatch", async () => {
		await seed_trust_policy(db, owner_id, { repo_pattern: "forbit-*" });
		const claims = make_branch_claims({ repository: "f0rbit/my-pkg", repository_owner: "f0rbit" });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("trust_policy_failed");
	});

	test("ref not in allowed_refs", async () => {
		await seed_trust_policy(db, owner_id, { allowed_refs: ["refs/heads/release/main"] });
		const claims = make_branch_claims({ ref: "refs/heads/main" });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("trust_policy_failed");
	});

	test("environment required but missing", async () => {
		await seed_trust_policy(db, owner_id, { allowed_environments: ["production"] });
		const claims = make_branch_claims({ environment: undefined });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("trust_policy_failed");
	});

	test("audience mismatch", async () => {
		await seed_trust_policy(db, owner_id, { expected_audience: "https://other.example" });
		const claims = make_branch_claims({ aud: BASE_AUDIENCE });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("trust_policy_failed");
	});
});

describe("exchange_oidc_for_session — wildcard semantics on empty arrays", () => {
	let db: Database;
	let owner_id: string;
	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		owner_id = u.id;
		await seed_package(db, owner_id, { id: "pipeline-package_my-pkg", name: "my-pkg", repo_url: "https://github.com/f0rbit/my-pkg" });
	});

	test("empty allowed_refs accepts any ref", async () => {
		await seed_trust_policy(db, owner_id, { allowed_refs: [] });
		const claims = make_branch_claims({ ref: "refs/heads/feature/something" });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(true);
	});

	test("empty allowed_environments accepts a missing environment", async () => {
		await seed_trust_policy(db, owner_id, { allowed_environments: [] });
		const claims = make_branch_claims({ environment: undefined });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(true);
	});

	test("empty allowed_environments also accepts a present environment", async () => {
		await seed_trust_policy(db, owner_id, { allowed_environments: [] });
		const claims = make_branch_claims({ environment: "production" });
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_my-pkg" }
		);
		expect(result.ok).toBe(true);
	});
});

describe("exchange_oidc_for_session — package_not_found / package_scope_mismatch", () => {
	let db: Database;
	let owner_id: string;
	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		owner_id = u.id;
		await seed_trust_policy(db, owner_id);
	});

	test("package_not_found when package_id unknown", async () => {
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_does-not-exist" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("package_not_found");
	});

	test("package_scope_mismatch when repo_url disagrees with claims.repository", async () => {
		await seed_package(db, owner_id, { id: "pipeline-package_wrong-repo", name: "wrong-repo", repo_url: "https://github.com/other-org/wrong-repo" });
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_wrong-repo" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("package_scope_mismatch");
		if (result.error.kind !== "package_scope_mismatch") return;
		expect(result.error.claimed_repo).toBe("f0rbit/my-pkg");
		expect(result.error.declared_repo).toBe("other-org/wrong-repo");
	});

	test("package_scope_mismatch when repo_url is null", async () => {
		await seed_package(db, owner_id, { id: "pipeline-package_unbound", name: "unbound", repo_url: null });
		const claims = make_branch_claims();
		const verifier = make_fake_verifier(new Map([["jwt_a", claims]]));
		const signer = make_fake_signer();
		const result = await exchange_oidc_for_session(
			{ db, verify_oidc: verifier.verify, sign_session: signer.sign, now: () => new Date(), new_jti: next_jti },
			{ jwt: "jwt_a", package_id: "pipeline-package_unbound" }
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("package_scope_mismatch");
		if (result.error.kind !== "package_scope_mismatch") return;
		expect(result.error.declared_repo).toBeNull();
	});
});

describe("match_trust_policy — direct tests", () => {
	test("respects audience binding", () => {
		const policy = {
			id: "p_a",
			owner_id: "u",
			provider: "github",
			github_owner: "f0rbit",
			repo_pattern: "*",
			allowed_refs: [],
			allowed_environments: [],
			expected_audience: "https://aud-a.example",
			allowed_actions: ["artifacts:upload"],
			session_ttl_seconds: 900,
			last_used_at: null,
			created_at: "2026-05-01T00:00:00Z",
			updated_at: "2026-05-01T00:00:00Z",
			created_by: "api",
			modified_by: "api",
			protected: false,
			deleted: false,
		} as never;
		const claims = make_branch_claims({ aud: "https://aud-b.example" });
		const matched = match_trust_policy(claims, [policy]);
		expect(matched.ok).toBe(false);
	});

	test("glob: 'forbit-*' matches 'forbit-astro' but not 'astro-thing'", () => {
		const policy = {
			id: "p_a",
			owner_id: "u",
			provider: "github",
			github_owner: "f0rbit",
			repo_pattern: "forbit-*",
			allowed_refs: [],
			allowed_environments: [],
			expected_audience: BASE_AUDIENCE,
			allowed_actions: ["artifacts:upload"],
			session_ttl_seconds: 900,
			last_used_at: null,
			created_at: "2026-05-01T00:00:00Z",
			updated_at: "2026-05-01T00:00:00Z",
			created_by: "api",
			modified_by: "api",
			protected: false,
			deleted: false,
		} as never;

		const good = match_trust_policy(make_branch_claims({ repository: "f0rbit/forbit-astro" }), [policy]);
		expect(good.ok).toBe(true);

		const bad = match_trust_policy(make_branch_claims({ repository: "f0rbit/astro-thing" }), [policy]);
		expect(bad.ok).toBe(false);
	});
});
