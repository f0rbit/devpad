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
 * Read-only orchestrator routes (`POST /runs`, `GET /runs`, `/health`,
 * `/grants`) are intentionally left unauthenticated — they're already
 * gated by the calling user's devpad session via the API layer. Only
 * the corpus-write surface is publicly callable, so it's the one that
 * needs a token.
 *
 * Pure helpers (`is_bearer_valid`, `parse_bearer_header`) are split out
 * for unit tests. The async `require_bearer_token` is the integration
 * surface that touches the secrets store.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import type { PipelineEnv } from "./bindings.ts";

export type AuthError =
	| { code: "unauthorized"; message: string }
	| { code: "auth_unavailable"; message: string };

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
 * Resolve the configured token from `env.PIPELINES_TOKEN.get()` and
 * compare it against the request's `Authorization` header. Returns
 * `ok(undefined)` on success.
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
	if (expected === undefined || expected === "") {
		return err({ code: "auth_unavailable", message: "PIPELINES_TOKEN resolved to empty" });
	}
	const header = request.headers.get("authorization");
	if (!is_bearer_valid(header, expected)) {
		return err({ code: "unauthorized", message: "missing or invalid Authorization: Bearer <token>" });
	}
	return ok(undefined);
};
