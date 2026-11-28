/**
 * devpad orchestrator → vault: `CloudflareVault.observability_query(input, identity)`.
 *
 * Powers `GET /ops/exceptions` (the `check` verb's "any Workers exceptions
 * since this deploy?" probe). Vault holds the only Cloudflare Observability
 * credential; the orchestrator never sees it. Identity travels as an
 * explicit RPC argument — CF service bindings do NOT propagate caller env
 * vars — and vault checks the single grant scope
 * `cloudflare:observability:read` for `(identity.package_id,
 * identity.environment)` before touching its token.
 *
 * Least privilege per script is NOT expressed through separate grants: it
 * is the fixed `observability_scripts` allowlist below, enforced by vault's
 * input validation even when the grant exists.
 *
 * The 24h `since` window depends on the clock, so the schema is built by
 * `cloudflare_observability_query_input_at(now)` with an injected `now`.
 * Fixtures are validated at the fixed `observability_fixture_now`;
 * consumers must inject the same clock when replaying them.
 */
import { z } from "zod";
import { grant_environment } from "./grants-check.js";

export const observability_grant_scope = "cloudflare:observability:read";

export const observability_scripts = ["devpad-unified", "devpad-unified-preview", "devpad-pipelines"] as const;

export const observability_script = z.enum(observability_scripts);

export const observability_since_window_ms = 24 * 60 * 60 * 1000;

export const observability_max_samples = 5;

export const observability_fixture_now = new Date("2026-11-28T12:00:00.000Z");

const observability_query_shape = z
	.object({
		script: observability_script,
		since: z.string().datetime({ offset: true }),
	})
	.strict();

const within_window = (now: Date, since: string) =>
	now.getTime() - new Date(since).getTime() <= observability_since_window_ms;

export const cloudflare_observability_query_input_at = (now: Date) =>
	observability_query_shape.refine(({ since }) => within_window(now, since), {
		message: "since must be no more than 24h before now",
		path: ["since"],
	});

export const cloudflare_observability_query_input = cloudflare_observability_query_input_at(observability_fixture_now);

export type CloudflareObservabilityQueryInput = z.infer<typeof observability_query_shape>;

export const cloudflare_observability_identity = z
	.object({
		package_id: z.string().min(1),
		environment: grant_environment,
	})
	.strict();

export type CloudflareObservabilityIdentity = z.infer<typeof cloudflare_observability_identity>;

export const observability_sample = z
	.object({
		ts: z.string().datetime({ offset: true }),
		message: z.string().max(500),
	})
	.strict();

export const cloudflare_observability_output = z
	.object({
		script: observability_script,
		since: z.string().datetime({ offset: true }),
		exception_count: z.number().int().nonnegative(),
		samples: z.array(observability_sample).max(observability_max_samples),
	})
	.strict();

export type CloudflareObservabilityOutput = z.infer<typeof cloudflare_observability_output>;

/**
 * The Cloudflare REST failure the adapter saw, wrapped under
 * `upstream_error.cause`. Parallel to `github_upstream_error` (whose
 * `not_found` has no analogue: an unknown script yields a zero count).
 */
export const cloudflare_upstream_error = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("rate_limited"), status: z.literal(429), message: z.string() }),
	z.object({ kind: z.literal("unauthorized"), status: z.number().int(), message: z.string() }),
	z.object({ kind: z.literal("validation"), status: z.number().int(), message: z.string() }),
	z.object({ kind: z.literal("internal"), status: z.number().int(), message: z.string() }),
	z.object({ kind: z.literal("network"), message: z.string() }),
	z.object({ kind: z.literal("decode"), message: z.string() }),
]);

/**
 * Mirror of `GitHubVaultError`'s shape — every way the RPC itself can fail.
 */
export const cloudflare_vault_error = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("identity_missing"), message: z.string() }),
	z.object({ kind: z.literal("grant_denied"), scope: z.string().min(1), reason: z.string().optional() }),
	z.object({ kind: z.literal("grant_check_failed"), message: z.string() }),
	z.object({ kind: z.literal("invalid_input"), message: z.string() }),
	z.object({ kind: z.literal("upstream_error"), cause: cloudflare_upstream_error }),
]);

export type CloudflareVaultWireError = z.infer<typeof cloudflare_vault_error>;

export const cloudflare_observability_result = z.union([
	z.object({ ok: z.literal(true), value: cloudflare_observability_output }),
	z.object({ ok: z.literal(false), error: cloudflare_vault_error }),
]);
