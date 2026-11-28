/**
 * Vault → devpad orchestrator: `PipelinesGrantsEndpoint.check(caller, scope)`.
 *
 * Source of truth: `packages/pipelines/src/grants-rpc.ts` (the typed RPC
 * surface) — this module re-declares it as Zod so the cross-repo boundary
 * is fixture-tested. Vault must never read devpad's D1 directly; this
 * check call is the only channel through which grant state leaves the
 * orchestrator.
 *
 * `environment` is pinned to the two literals `CALLER_ENV` can ever
 * resolve to (`caller-identity.ts` maps every stage to `staging` or
 * `production`); anything else — including the historical `"prod"` — is
 * a contract violation even though the service's own runtime validation
 * happens to accept any non-empty string.
 */
import { z } from "zod";

export const grant_environment = z.enum(["staging", "production"]);

export const grant_check_caller = z
	.object({
		package_id: z.string().min(1),
		environment: grant_environment,
		version_set_id: z.string().min(1),
	})
	.strict();

export type GrantCheckCaller = z.infer<typeof grant_check_caller>;

export const grant_check_scope = z.string().min(1);

export const grant_check_call = z
	.object({
		caller: grant_check_caller,
		scope: grant_check_scope,
	})
	.strict();

export const grant_check_response = z
	.object({
		granted: z.boolean(),
		reason: z.string().optional(),
	})
	.strict();

export type GrantCheckResponse = z.infer<typeof grant_check_response>;

export const grant_check_error = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("invalid_caller"), message: z.string() }),
	z.object({ kind: z.literal("store_error"), message: z.string() }),
]);

export const grant_check_result = z.union([
	z.object({ ok: z.literal(true), value: grant_check_response }),
	z.object({ ok: z.literal(false), error: grant_check_error }),
]);
