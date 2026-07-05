/**
 * @module pipelines/bindings
 *
 * Worker environment for the pipelines orchestrator. Mirrors the
 * structure of `packages/worker/src/bindings.ts` but isolated to the
 * resources this Worker needs.
 *
 * The DO is keyed off the run id. D1 holds the source of truth for
 * `pipeline_run` rows — the DO is just an alarm host + last-event
 * scratchpad.
 *
 * Vault is bound as a service binding. The orchestrator only forwards
 * the binding to workload Workers via scaffolder templates — it does
 * not call vault directly. The canonical RPC contract lives in
 * `~/dev/vault/src/index.ts` + `~/dev/vault/src/types.ts`.
 */

import type {
	D1Database,
	DurableObjectNamespace,
	Fetcher,
	R2Bucket,
	SecretsStoreSecret,
} from "@cloudflare/workers-types";

// ─── Environment type ───────────────────────────────────────────────

export type PipelineEnv = {
	DB: D1Database;
	CORPUS_BUCKET: R2Bucket;
	PIPELINE_RUNS: DurableObjectNamespace;
	// ANTHROPIC bound to vault Worker. The orchestrator does not call
	// vault directly; the binding is propagated to workload Workers.
	// For the typed RPC surface, see `~/dev/vault/src/types.ts`.
	ANTHROPIC: Fetcher;
	PULSE: Fetcher;
	ENVIRONMENT: "development" | "staging" | "production";
	// Cloudflare account id the orchestrator deploys runs into. Optional
	// — only required when a pipeline run actually hits the CF API. Read-
	// only routes (GET /runs, /grants, /health) don't need it.
	CF_ACCOUNT_ID?: string;
	// Cloudflare API token (Secrets Store secret) — `Workers Scripts:Edit`
	// scope on `CF_ACCOUNT_ID`. Used by the prod CloudflareProvider to
	// upload versions + create deployments for managed Workers.
	// Optional at the type level so deploys without the token (read-only
	// orchestrator) still typecheck; the factory throws lazily when an
	// actual CF API call is made without it.
	CF_API_TOKEN?: SecretsStoreSecret;
	// Shared bearer secret guarding `POST /artifacts/*`. CLI clients
	// running in CI present this via `Authorization: Bearer <token>` to
	// upload manifest + blob artifacts into the orchestrator's corpus
	// stores. Optional at the type level — a deploy without the secret
	// still serves the read-only routes; artifact uploads return
	// `auth_unavailable` until the secret is provisioned.
	PIPELINES_TOKEN?: SecretsStoreSecret;
	// HS256 signing key for orchestrator-minted session JWTs. Required
	// when `POST /auth/github-oidc` is wired; absence makes that route
	// return 503 `auth_unavailable`. 64 random bytes recommended,
	// base64-encoded for storage.
	OIDC_SESSION_SIGNING_KEY?: SecretsStoreSecret;
	// Expected `aud` claim value on GitHub Actions OIDC tokens. The
	// orchestrator's public URL by convention; per-policy override lives
	// in `pipeline_oidc_trust.expected_audience` for multi-aud setups.
	OIDC_EXPECTED_AUDIENCE?: string;
	// Override for the OIDC issuer (defaults to the GitHub Actions
	// issuer URL). Plain var; never sensitive.
	GITHUB_OIDC_ISSUER?: string;
};
