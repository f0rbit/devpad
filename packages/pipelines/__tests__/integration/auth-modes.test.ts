/**
 * @module pipelines/tests/auth-modes
 *
 * Test matrix for Phase 15 auth modes: admin bearer, session JWT, fallback,
 * scope enforcement, and package scoping.
 */

import { describe, expect, test } from "bun:test";
import { err, ok } from "@f0rbit/corpus";
import type { AuthIdentity, OidcSessionClaims, SessionVerifier } from "../../src/auth";
import { authenticate_request } from "../../src/auth";
import type { PipelineEnv } from "../../src/bindings";

describe("authenticate_request", () => {
	// In-memory fake verifier for tests
	const make_fake_verifier = (
		claimsOrError?: OidcSessionClaims | { code: string; message: string },
	): SessionVerifier => ({
		verify: async (_token) => {
			if (claimsOrError === undefined) {
				return err({ code: "verification_failed", message: "test: no claims configured" });
			}
			if ("code" in claimsOrError) {
				return err(claimsOrError);
			}
			return ok(claimsOrError);
		},
	});

	const make_fake_env = (pipelines_token: string): PipelineEnv => ({
		DB: {} as never,
		CORPUS_BUCKET: {} as never,
		PIPELINE_RUNS: {} as never,
		ANTHROPIC: {} as never,
		PULSE: {} as never,
		ENVIRONMENT: "development",
		CF_ACCOUNT_ID: undefined,
		CF_API_TOKEN: undefined,
		PIPELINES_TOKEN: {
			get: async () => pipelines_token,
		} as never,
	});

	const admin_token = "admin-secret-12345";

	test("admin bypass via literal bearer token", async () => {
		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: `Bearer ${admin_token}` },
		});
		const verifier = make_fake_verifier();

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.kind).toBe("admin");
		if (result.value.kind !== "admin") throw new Error("expected admin");
		expect(result.value.reason).toBe("pipelines_token");
	});

	test("session JWT within scope and package access", async () => {
		const claims: OidcSessionClaims = {
			iss: "devpad-pipelines",
			aud: "devpad-pipelines",
			exp: Math.floor(Date.now() / 1000) + 900,
			iat: Math.floor(Date.now() / 1000),
			jti: "test-jti",
			sub: "package:my-package",
			scope: ["artifacts:upload", "runs:start"],
			package_ids: ["my-package", "other-package"],
			trust_policy_id: "policy-1",
			oidc: {
				sub: "repo:owner/repo:ref:refs/heads/main",
				repository: "owner/repo",
				ref: "refs/heads/main",
				sha: "abc123",
				run_id: "123",
				actor: "bot-user",
			},
		};

		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: "Bearer eyJ0eXAiOiJKV1QifQ.payload.signature" },
		});
		const verifier = make_fake_verifier(claims);

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.kind).toBe("session");
		if (result.value.kind !== "session") throw new Error("expected session");
		expect(result.value.package_ids).toEqual(["my-package", "other-package"]);
		expect(result.value.scope).toEqual(["artifacts:upload", "runs:start"]);
		expect(result.value.trust_policy_id).toBe("policy-1");
		expect(result.value.oidc.repository).toBe("owner/repo");
	});

	test("session JWT with no package access (empty package_ids)", async () => {
		const claims: OidcSessionClaims = {
			iss: "devpad-pipelines",
			aud: "devpad-pipelines",
			exp: Math.floor(Date.now() / 1000) + 900,
			iat: Math.floor(Date.now() / 1000),
			jti: "test-jti",
			sub: "owner:user-123",
			scope: ["artifacts:upload"],
			package_ids: [],
			trust_policy_id: "policy-1",
			oidc: {
				sub: "repo:owner/repo:ref:refs/heads/main",
				repository: "owner/repo",
				ref: "refs/heads/main",
				sha: "abc123",
				run_id: "123",
				actor: "bot-user",
			},
		};

		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: "Bearer eyJ0eXAiOiJKV1QifQ.payload.signature" },
		});
		const verifier = make_fake_verifier(claims);

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.kind).toBe("session");
		if (result.value.kind !== "session") throw new Error("expected session");
		expect(result.value.package_ids).toEqual([]);
	});

	test("expired session falls through to bearer comparison", async () => {
		const expired_claims: OidcSessionClaims = {
			iss: "devpad-pipelines",
			aud: "devpad-pipelines",
			exp: Math.floor(Date.now() / 1000) - 100, // expired
			iat: Math.floor(Date.now() / 1000) - 1000,
			jti: "test-jti",
			sub: "package:my-package",
			scope: ["artifacts:upload"],
			package_ids: ["my-package"],
			trust_policy_id: "policy-1",
			oidc: {
				sub: "repo:owner/repo:ref:refs/heads/main",
				repository: "owner/repo",
				ref: "refs/heads/main",
				sha: "abc123",
				run_id: "123",
				actor: "bot-user",
			},
		};

		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: `Bearer ${admin_token}` },
		});
		const verifier = make_fake_verifier({ code: "token_expired", message: "JWT expired" });

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.kind).toBe("admin");
	});

	test("malformed bearer returns 401", async () => {
		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: "Bearer wrong-token" },
		});
		const verifier = make_fake_verifier();

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.code).toBe("unauthorized");
	});

	test("missing authorization header returns 401", async () => {
		const env = make_fake_env(admin_token);
		const request = new Request("https://test");
		const verifier = make_fake_verifier();

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.code).toBe("unauthorized");
	});

	test("JWT-shaped bearer that fails session verify but matches admin token", async () => {
		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: `Bearer ${admin_token}` },
		});
		const verifier = make_fake_verifier({ code: "sig_invalid", message: "signature mismatch" });

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");
		expect(result.value.kind).toBe("admin");
	});

	test("literal bearer that doesn't match admin token and isn't JWT-shaped", async () => {
		const env = make_fake_env(admin_token);
		const request = new Request("https://test", {
			headers: { authorization: "Bearer some-random-string" },
		});
		const verifier = make_fake_verifier();

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.code).toBe("unauthorized");
	});

	test("PIPELINES_TOKEN not bound returns auth_unavailable", async () => {
		const env: PipelineEnv = {
			DB: {} as never,
			CORPUS_BUCKET: {} as never,
			PIPELINE_RUNS: {} as never,
			ANTHROPIC: {} as never,
			PULSE: {} as never,
			ENVIRONMENT: "development",
			CF_ACCOUNT_ID: undefined,
			CF_API_TOKEN: undefined,
			PIPELINES_TOKEN: undefined,
		};
		const request = new Request("https://test", {
			headers: { authorization: "Bearer some-token" },
		});
		const verifier = make_fake_verifier();

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.code).toBe("auth_unavailable");
	});

	test("empty PIPELINES_TOKEN returns auth_unavailable", async () => {
		const env: PipelineEnv = {
			DB: {} as never,
			CORPUS_BUCKET: {} as never,
			PIPELINE_RUNS: {} as never,
			ANTHROPIC: {} as never,
			PULSE: {} as never,
			ENVIRONMENT: "development",
			CF_ACCOUNT_ID: undefined,
			CF_API_TOKEN: undefined,
			PIPELINES_TOKEN: {
				get: async () => "",
			} as never,
		};
		const request = new Request("https://test", {
			headers: { authorization: "Bearer some-token" },
		});
		const verifier = make_fake_verifier();

		const result = await authenticate_request(env, request, { verify_session: verifier });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error");
		expect(result.error.code).toBe("auth_unavailable");
	});
});
