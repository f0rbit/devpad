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
 * Vault is bound as a service binding. `ANTHROPIC` is only forwarded to
 * workload Workers via scaffolder templates; `GITHUB` (external deploy
 * mode #155) is the one binding the orchestrator calls directly —
 * vault's `GitHubVault.dispatch_workflow` RPC proxies the GitHub token.
 * The canonical RPC contract lives in `~/dev/vault/src/index.ts` +
 * `~/dev/vault/src/types.ts`; the `GitHubVaultBinding` type below is a
 * local structural match (vault's types are never imported).
 */

import type { Result } from "@f0rbit/corpus";
import type {
	D1Database,
	DurableObjectNamespace,
	Fetcher,
	R2Bucket,
	SecretsStoreSecret,
} from "@cloudflare/workers-types";

// ─── Vault GitHub dispatch contract (#155) ──────────────────────────

/**
 * Structural match of vault's `GitHubVault` named-entrypoint RPC
 * surface (`~/dev/vault/src/...`). Declared locally — per the
 * cross-repo invariant the vault repo is a separate security boundary
 * and its types are never imported. Vault checks the
 * `github:dispatch:<owner/repo>/<workflow-file>` grant for
 * `(identity.package_id, identity.environment)` before touching the
 * GitHub token.
 */
export type GitHubUpstreamError =
	| { kind: "rate_limited"; status: 429; message: string }
	| { kind: "unauthorized"; status: number; message: string }
	| { kind: "not_found"; status: 404; message: string }
	| { kind: "validation"; status: number; message: string }
	| { kind: "internal"; status: number; message: string }
	| { kind: "network"; message: string }
	| { kind: "decode"; message: string };

export type GitHubVaultError =
	| { kind: "identity_missing"; message: string }
	| { kind: "grant_denied"; scope: string; reason?: string }
	| { kind: "grant_check_failed"; message: string }
	| { kind: "invalid_input"; message: string }
	| { kind: "upstream_error"; cause: GitHubUpstreamError };

export type GitHubVaultBinding = {
	dispatch_workflow(
		input: {
			repo: string;
			workflow: string;
			ref: string;
			inputs: Record<string, string>;
		},
		identity: { package_id: string; environment: "staging" | "production" },
	): Promise<Result<{ dispatched: true; run_id?: number; run_url?: string }, GitHubVaultError>>;
};

// ─── Environment type ───────────────────────────────────────────────

export type PipelineEnv = {
	DB: D1Database;
	CORPUS_BUCKET: R2Bucket;
	PIPELINE_RUNS: DurableObjectNamespace;
	// ANTHROPIC bound to vault Worker. The orchestrator does not call
	// vault directly; the binding is propagated to workload Workers.
	// For the typed RPC surface, see `~/dev/vault/src/types.ts`.
	ANTHROPIC: Fetcher;
	// GITHUB bound to vault Worker's `GitHubVault` named-entrypoint class
	// (#155): CI-workflow dispatch for external-deploy packages. Vault
	// holds the GitHub token and enforces the
	// `github:dispatch:<owner/repo>/<workflow-file>` grant against
	// `{ package_id, environment: "production" }`. Optional at the type
	// level — without the binding external runs keep failing fast with
	// the existing typed `dispatcher` error.
	GITHUB?: GitHubVaultBinding;
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
	// Pulse observability (#158) — OPTIONAL, never in `require_deploy_secret`.
	// Observability must not block deploys. `PULSE_PROJECT_ID` scopes both
	// directions (ingest body field + query path param) and MUST match the
	// project the ingest key was issued for.
	//   PULSE_PROJECT_ID  — plain var; pulse project receiving events.
	//   PULSE_INGEST_KEY  — Secrets Store secret, `pk_*` plaintext, sent as the
	//                       `X-Pulse-Key` header on `POST /e`.
	//   PULSE_READ_KEY    — Secrets Store secret, devpad API key (scope
	//                       "pulse"), sent as `Authorization: Bearer` on the
	//                       query routes (`GET /events/:project_id`).
	// Unbound config degrades gracefully: the emitter no-ops (warns once),
	// the summary client returns typed `not_configured` so analysis gates
	// keep their fail-open-with-reason behaviour.
	PULSE_PROJECT_ID?: string;
	PULSE_INGEST_KEY?: SecretsStoreSecret;
	PULSE_READ_KEY?: SecretsStoreSecret;
};
