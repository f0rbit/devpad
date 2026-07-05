/**
 * @module pipelines/providers/oidc-verifier
 *
 * Production GitHub Actions OIDC verifier — wraps `jose.jwtVerify` against
 * a module-cached `createRemoteJWKSet` (per the spike notes in
 * `~/dev/.plans/oidc-trust.md` §B.4):
 *
 * - GitHub's JWKS endpoint does NOT send a `Cache-Control` header, so
 *   `cacheMaxAge: 10 * 60 * 1000` (10 min) becomes the effective TTL.
 * - `cooldownDuration: 30_000` throttles re-fetches on unknown `kid`s so
 *   a forged token can't DoS the upstream.
 *
 * The verifier asserts `iss`, `aud`, `exp`, `iat`, `nbf` via jose itself,
 * then runs the payload through `verified_oidc_claims_schema` to type the
 * GitHub-specific fields. Returns `Result<VerifiedOidcClaims, { reason }>`
 * so the orchestrator can map every failure to `invalid_oidc_token` with
 * a concrete reason string.
 */

import { verified_oidc_claims_schema, type VerifiedOidcClaims } from "@devpad/core/services/pipelines";
import { err, ok, type Result } from "@f0rbit/corpus";
import { createRemoteJWKSet, errors as jose_errors, type JWTPayload, jwtVerify } from "jose";

export type OidcVerifyError = { reason: string };

export interface OidcVerifier {
	verify(jwt: string): Promise<Result<VerifiedOidcClaims, OidcVerifyError>>;
}

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS_URL = new URL(`${GITHUB_ISSUER}/.well-known/jwks`);
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const JWKS_COOLDOWN_MS = 30_000;
const CLOCK_TOLERANCE_SECONDS = 60;

let cached_jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const get_jwks = () => {
	if (cached_jwks === null) {
		cached_jwks = createRemoteJWKSet(GITHUB_JWKS_URL, {
			cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
			cooldownDuration: JWKS_COOLDOWN_MS,
		});
	}
	return cached_jwks;
};

const map_jose_error = (e: unknown): OidcVerifyError => {
	if (e instanceof jose_errors.JWTExpired) return { reason: "jwt expired" };
	if (e instanceof jose_errors.JWTClaimValidationFailed) return { reason: `claim '${e.claim}' invalid: ${e.message}` };
	if (e instanceof jose_errors.JOSEAlgNotAllowed) return { reason: "signing algorithm not allowed" };
	if (e instanceof jose_errors.JWSSignatureVerificationFailed) return { reason: "signature verification failed" };
	if (e instanceof jose_errors.JWSInvalid) return { reason: "invalid JWS structure" };
	if (e instanceof jose_errors.JWTInvalid) return { reason: "invalid JWT structure" };
	if (e instanceof jose_errors.JWKSNoMatchingKey) return { reason: "no matching key in JWKS" };
	if (e instanceof jose_errors.JWKSInvalid) return { reason: "invalid JWKS response from issuer" };
	if (e instanceof jose_errors.JOSEError) return { reason: `jose error: ${e.code}` };
	return { reason: `unknown verification error: ${String(e)}` };
};

const verify_payload_shape = (payload: JWTPayload): Result<VerifiedOidcClaims, OidcVerifyError> => {
	const parsed = verified_oidc_claims_schema.safeParse(payload);
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		const path = first.path.join(".");
		return err({ reason: `claim shape invalid at '${path}': ${first.message}` });
	}
	return ok(parsed.data);
};

/**
 * Build a {@link OidcVerifier} bound to GitHub's JWKS and a specific
 * expected audience. `expected_audience` becomes the orchestrator URL at
 * deploy time (env var `OIDC_EXPECTED_AUDIENCE`); the policy table also
 * stores it per-row so multi-aud setups are possible without a redeploy.
 */
export const make_github_oidc_verifier = (config: { expected_audience: string }): OidcVerifier => {
	const verify = async (jwt: string): Promise<Result<VerifiedOidcClaims, OidcVerifyError>> => {
		if (typeof jwt !== "string" || jwt === "") return err({ reason: "empty jwt" });
		if (jwt.split(".").length !== 3) return err({ reason: "jwt must have three segments" });

		try {
			const { payload } = await jwtVerify(jwt, get_jwks(), {
				issuer: GITHUB_ISSUER,
				audience: config.expected_audience,
				algorithms: ["RS256"],
				clockTolerance: CLOCK_TOLERANCE_SECONDS,
			});
			return verify_payload_shape(payload);
		} catch (e) {
			return err(map_jose_error(e));
		}
	};

	return { verify };
};

/**
 * Reset the module-cached JWKS reference. Used in tests; never call from
 * production paths.
 */
export const __reset_jwks_cache_for_tests = (): void => {
	cached_jwks = null;
};
