/**
 * chamber CI → devpad orchestrator: `POST /auth/github-oidc`.
 *
 * Exchanges a GitHub Actions OIDC JWT for an orchestrator-signed
 * session JWT, scoped by the `pipeline_oidc_trust` policy. Mirrors the
 * route's `oidc_exchange_body` (`packages/pipelines/src/routes.ts`) and
 * `OidcExchangeOutput` (`packages/core/src/services/pipelines/oidc.ts`)
 * — declared here because the schema package cannot import from the
 * pipelines package (the dependency points the other way).
 *
 * `scope` is the GRANTED scope, the intersection of `requested_scope`
 * and the trust policy's `allowed_actions`; the literal list mirrors
 * `OIDC_SESSION_SCOPES` in `oidc-types.ts`. Adding a scope there is a
 * contract change: update these fixtures in the same PR.
 */
import { z } from "zod";
import { wire_error } from "./wire.js";

export const oidc_session_scopes = [
	"artifacts:upload",
	"packages:write",
	"runs:cancel",
	"runs:events",
	"runs:rollback",
	"runs:start",
] as const;

export const oidc_session_scope = z.enum(oidc_session_scopes);

export const oidc_exchange_request = z.object({
	jwt: z.string().min(1),
	package_id: z.string().min(1).optional(),
	requested_scope: z.array(z.string().min(1)).optional(),
});

export type OidcExchangeRequest = z.infer<typeof oidc_exchange_request>;

export const oidc_exchange_success = z.object({
	session_token: z.string().min(1),
	expires_at: z.string().datetime({ offset: true }),
	scope: z.array(oidc_session_scope),
	package_ids: z.array(z.string().min(1)),
	trust_policy_id: z.string().min(1),
});

export type OidcExchangeSuccess = z.infer<typeof oidc_exchange_success>;

export const oidc_exchange_response = z.union([
	z.object({ ok: z.literal(true), value: oidc_exchange_success }),
	wire_error,
]);
