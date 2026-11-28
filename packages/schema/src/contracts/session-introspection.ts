/**
 * devpad main worker → orchestrator: `PipelinesSessionEndpoint.introspect(token)`.
 *
 * The main worker resolves an `Authorization: Session <jwt>` request by
 * asking the orchestrator (over the `PIPELINES_SESSIONS` service binding)
 * whether the CI session token is live, instead of holding
 * `OIDC_SESSION_SIGNING_KEY` itself. The orchestrator reuses its
 * `SessionVerifier` (signature, `exp`, `iss`/`aud`).
 *
 * `scope` is deliberately an open string list: it carries whatever
 * `OIDC_SESSION_SCOPES` currently grants (including `check:read`), and the
 * consumer decides which scope it requires.
 */
import { z } from "zod";

export const session_introspection_input = z
	.object({
		token: z.string().min(1),
	})
	.strict();

export type SessionIntrospectionInput = z.infer<typeof session_introspection_input>;

export const session_introspection_active = z
	.object({
		active: z.literal(true),
		sub: z.string().min(1),
		scope: z.array(z.string().min(1)),
		package_ids: z.array(z.string().min(1)),
		trust_policy_id: z.string().min(1),
		expires_at: z.string().datetime({ offset: true }),
	})
	.strict();

export const session_introspection_inactive = z
	.object({
		active: z.literal(false),
		reason: z.string().min(1),
	})
	.strict();

export const session_introspection_result = z.discriminatedUnion("active", [
	session_introspection_active,
	session_introspection_inactive,
]);

export type SessionIntrospectionResult = z.infer<typeof session_introspection_result>;
