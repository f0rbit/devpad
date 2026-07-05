/**
 * @module pipelines/providers/session-signer
 *
 * Production HS256 signer + verifier for orchestrator session tokens.
 *
 * - Signing material: `OIDC_SESSION_SIGNING_KEY` (Secrets Store secret;
 *   64 random bytes, base64-encoded). Read lazily on the first sign /
 *   verify call and cached at module scope for the lifetime of the
 *   Worker isolate. Re-deploying with a new secret invalidates every
 *   in-flight 15-min token — accepted break-glass cost.
 * - Algorithm: HS256 (symmetric — single Worker is both signer and
 *   verifier).
 * - On a missing secret the signer returns
 *   `Result<_, { reason: "auth_unavailable" }>` so the route layer maps
 *   it to 503 instead of leaking a generic 500.
 */

import type { OidcSessionClaims } from "@devpad/core/services/pipelines";
import type { SecretsStoreSecret } from "@cloudflare/workers-types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { errors as jose_errors, jwtVerify, SignJWT } from "jose";

export type SessionSignError = { reason: string };
export type SessionVerifyError = { reason: string };

export type SessionSigner = {
	sign(claims: OidcSessionClaims): Promise<Result<string, SessionSignError>>;
	verify(token: string): Promise<Result<OidcSessionClaims, SessionVerifyError>>;
};

const SESSION_ISSUER = "devpad-pipelines";
const SESSION_AUDIENCE = "devpad-pipelines";

const decode_signing_key = (raw: string): Uint8Array => {
	// Accept either base64 (the recommended storage form) or a literal
	// utf-8 string. Most production keys are base64; tests may pass an
	// ascii string straight through.
	const trimmed = raw.trim();
	if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length % 4 === 0 && trimmed.length >= 24) {
		try {
			const binary = atob(trimmed);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			return bytes;
		} catch {
			// fall through to utf-8 encode
		}
	}
	return new TextEncoder().encode(trimmed);
};

const map_verify_error = (e: unknown): SessionVerifyError => {
	if (e instanceof jose_errors.JWTExpired) return { reason: "session token expired" };
	if (e instanceof jose_errors.JWTClaimValidationFailed) return { reason: `claim '${e.claim}' invalid: ${e.message}` };
	if (e instanceof jose_errors.JOSEAlgNotAllowed) return { reason: "session algorithm not allowed" };
	if (e instanceof jose_errors.JWSSignatureVerificationFailed) return { reason: "session signature invalid" };
	if (e instanceof jose_errors.JWSInvalid) return { reason: "session jws invalid" };
	if (e instanceof jose_errors.JWTInvalid) return { reason: "session jwt invalid" };
	if (e instanceof jose_errors.JOSEError) return { reason: `session jose error: ${e.code}` };
	return { reason: `unknown session error: ${String(e)}` };
};

/**
 * Build a session signer / verifier bound to a Secrets Store secret. The
 * secret value is fetched lazily and cached — first call pays the
 * Secrets Store round-trip, all subsequent calls in the same isolate
 * reuse the cached key bytes.
 */
export const make_session_signer = (env: { OIDC_SESSION_SIGNING_KEY?: SecretsStoreSecret }): SessionSigner => {
	let cached_key: Uint8Array | null = null;

	const get_key = async (): Promise<Result<Uint8Array, { reason: string }>> => {
		if (cached_key !== null) return ok(cached_key);
		if (env.OIDC_SESSION_SIGNING_KEY === undefined) {
			return err({ reason: "OIDC_SESSION_SIGNING_KEY not bound on this Worker" });
		}
		const raw = await env.OIDC_SESSION_SIGNING_KEY.get();
		if (raw === "") {
			return err({ reason: "OIDC_SESSION_SIGNING_KEY resolved to empty value" });
		}
		cached_key = decode_signing_key(raw);
		return ok(cached_key);
	};

	const sign = async (claims: OidcSessionClaims): Promise<Result<string, SessionSignError>> => {
		const key = await get_key();
		if (!key.ok) return err({ reason: key.error.reason });

		try {
			// jose puts the standard claims via builder methods; we keep
			// the custom fields (scope, package_ids, trust_policy_id, oidc)
			// on the top-level payload.
			const { iss: _iss, aud: _aud, exp: _exp, iat: _iat, jti: _jti, sub: _sub, ...custom } = claims;
			const token = await new SignJWT({ ...custom })
				.setProtectedHeader({ alg: "HS256", typ: "JWT" })
				.setIssuer(claims.iss)
				.setAudience(claims.aud)
				.setSubject(claims.sub)
				.setJti(claims.jti)
				.setIssuedAt(claims.iat)
				.setExpirationTime(claims.exp)
				.sign(key.value);
			return ok(token);
		} catch (e) {
			return err({ reason: `failed to sign session: ${String(e)}` });
		}
	};

	const verify = async (token: string): Promise<Result<OidcSessionClaims, SessionVerifyError>> => {
		const key = await get_key();
		if (!key.ok) return err({ reason: key.error.reason });

		try {
			const { payload } = await jwtVerify(token, key.value, {
				issuer: SESSION_ISSUER,
				audience: SESSION_AUDIENCE,
				algorithms: ["HS256"],
			});
			return ok(payload as unknown as OidcSessionClaims);
		} catch (e) {
			return err(map_verify_error(e));
		}
	};

	return { sign, verify };
};
