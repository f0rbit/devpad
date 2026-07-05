/**
 * @module pipelines/auth
 *
 * Bearer-token authentication for the artifact-upload routes.
 *
 * The orchestrator's write surface (`POST /artifacts/blob`,
 * `POST /artifacts/version-set`) is gated by a shared secret bound at
 * deploy time as `PIPELINES_TOKEN` (a `SecretsStoreSecret`). CLI clients
 * present the token via `Authorization: Bearer <token>`; the route
 * middleware looks up the live secret value and compares.
 *
 * Phase 15: Extended to also accept session JWTs from GitHub Actions OIDC
 * exchange via `POST /auth/github-oidc`. Session tokens are HS256-signed
 * and scoped to specific packages. Admin bearer (literal PIPELINES_TOKEN)
 * bypasses package scoping. A valid-but-unverified JWT falls through to
 * bearer comparison (soft cutover for literal bearers that happen to look
 * like 3 dot-separated segments).
 *
 * Pure helpers (`is_bearer_valid`, `parse_bearer_header`) are split out
 * for unit tests. The async `authenticate_request` is the integration
 * surface that touches secrets + verification.
 */

import type { OidcAudit, OidcSessionClaims } from "@devpad/core/services/pipelines";
import { err, ok, type Result } from "@f0rbit/corpus";
import type { PipelineEnv } from "./bindings";

export type { OidcAudit, OidcSessionClaims } from "@devpad/core/services/pipelines";

export type AuthIdentity =
	| { kind: "admin"; reason: "pipelines_token" }
	| {
			kind: "session";
			package_ids: string[];
			scope: string[];
			trust_policy_id: string;
			oidc: OidcAudit;
	  };

export type AuthError = { code: "unauthorized"; message: string } | { code: "auth_unavailable"; message: string };

export interface SessionVerifier {
	verify(token: string): Promise<Result<OidcSessionClaims, { code: string; message: string }>>;
}

const BEARER_PREFIX = "Bearer ";

/**
 * Extract the token portion from an `Authorization: Bearer <token>`
 * header value. Returns `null` if the header is missing, malformed, or
 * uses a different scheme.
 */
export const parse_bearer_header = (header: string | null): string | null => {
	if (header === null) return null;
	if (!header.startsWith(BEARER_PREFIX)) return null;
	const token = header.slice(BEARER_PREFIX.length).trim();
	if (token === "") return null;
	return token;
};

/**
 * Constant-time-ish bearer comparison. We aren't defending against
 * sophisticated timing attacks (this is an HTTP route in a serverless
 * Worker), but we still match length first so a token-shape probe
 * doesn't leak the expected prefix.
 */
export const is_bearer_valid = (header: string | null, expected: string): boolean => {
	const token = parse_bearer_header(header);
	if (token === null) return false;
	if (token.length !== expected.length) return false;
	let acc = 0;
	for (let i = 0; i < token.length; i++) acc |= token.charCodeAt(i) ^ expected.charCodeAt(i);
	return acc === 0;
};

/**
 * Detect if a string looks like a JWT (3 dot-separated segments with
 * a parseable header). Used to distinguish between JWTs and arbitrary
 * bearer tokens.
 */
const looks_like_jwt = (token: string): boolean => {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	try {
		JSON.parse(atob(parts[0]));
		return true;
	} catch {
		return false;
	}
};

/**
 * Authenticate an inbound request by checking either a session JWT
 * (via verify_session) or a literal admin bearer token (via PIPELINES_TOKEN).
 *
 * Flow:
 * 1. Parse `Authorization: Bearer <token>`
 * 2. If token looks like a JWT (3 dot-separated segments), try session verify:
 *    - On success: return `{ kind: "session", ... }`
 *    - On failure: fall through to bearer comparison
 * 3. Else (or after JWT failure): compare to `env.PIPELINES_TOKEN.get()`
 *    constant-time equality
 * 4. Both fail: `err({ code: "unauthorized" })`
 *
 * Failure modes:
 * - `auth_unavailable` — `PIPELINES_TOKEN` isn't bound (session verify may
 *   still work if it's injected via deps)
 * - `unauthorized` — header missing, no matching session, no matching bearer
 */
export const authenticate_request = async (
	env: PipelineEnv,
	request: Request,
	deps: { verify_session: SessionVerifier },
): Promise<Result<AuthIdentity, AuthError>> => {
	const header = request.headers.get("authorization");
	const token = parse_bearer_header(header);
	if (token === null) {
		return err({ code: "unauthorized", message: "missing Authorization: Bearer <token>" });
	}

	// Try session JWT verification first if token looks like a JWT
	if (looks_like_jwt(token)) {
		const session_result = await deps.verify_session.verify(token);
		if (session_result.ok) {
			const claims = session_result.value;
			return ok({
				kind: "session",
				package_ids: claims.package_ids,
				scope: claims.scope,
				trust_policy_id: claims.trust_policy_id,
				oidc: claims.oidc,
			});
		}
		// Fall through to bearer comparison if session verify fails
	}

	// Try admin bearer token comparison
	if (env.PIPELINES_TOKEN === undefined) {
		return err({ code: "auth_unavailable", message: "PIPELINES_TOKEN is not bound on this Worker" });
	}
	const expected = await env.PIPELINES_TOKEN.get();
	if (expected === "") {
		return err({ code: "auth_unavailable", message: "PIPELINES_TOKEN resolved to empty" });
	}

	if (is_bearer_valid(header, expected)) {
		return ok({ kind: "admin", reason: "pipelines_token" });
	}

	return err({ code: "unauthorized", message: "invalid token or bearer mismatch" });
};

/**
 * Resolve the configured token from `env.PIPELINES_TOKEN.get()` and
 * compare it against the request's `Authorization` header. Returns
 * `ok(undefined)` on success.
 *
 * DEPRECATED: use `authenticate_request` instead. Kept for internal
 * compatibility with existing route wiring.
 *
 * Failure modes:
 * - `auth_unavailable` — `PIPELINES_TOKEN` isn't bound on this Worker.
 *   The Worker can still serve read-only routes; only `/artifacts/*`
 *   should hit this code path.
 * - `unauthorized` — header missing or token mismatched.
 */
export const require_bearer_token = async (env: PipelineEnv, request: Request): Promise<Result<void, AuthError>> => {
	if (env.PIPELINES_TOKEN === undefined) {
		return err({ code: "auth_unavailable", message: "PIPELINES_TOKEN is not bound on this Worker" });
	}
	const expected = await env.PIPELINES_TOKEN.get();
	if (expected === "") {
		return err({ code: "auth_unavailable", message: "PIPELINES_TOKEN resolved to empty" });
	}
	const header = request.headers.get("authorization");
	if (!is_bearer_valid(header, expected)) {
		return err({ code: "unauthorized", message: "missing or invalid Authorization: Bearer <token>" });
	}
	return ok(undefined);
};
