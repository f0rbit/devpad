/**
 * Alchemy IaC for the pipelines orchestrator Worker.
 *
 * Bindings:
 * - `DB` — devpad's existing D1 (`devpad-unified-db`), shared with apps/main.
 *   Adopted, NOT created. The orchestrator is a Phase-13.C singleton; the
 *   staging stage was removed and there is no longer a `devpad-unified-db-preview`
 *   binding alternative.
 * - `CORPUS_BUCKET` — existing R2 bucket (`devpad-corpus`). Adopted.
 * - `PIPELINE_RUNS` — Durable Object namespace bound to `PipelineRunDO`
 *   (SQLite-backed; migration tag v1).
 * - `ANTHROPIC` — service binding to vault Worker (RPC entrypoint `AnthropicVault`).
 * - `GITHUB` — service binding to vault Worker's `GitHubVault` named
 *   entrypoint (#155): external-deploy CI-workflow dispatch. Vault
 *   holds the GitHub token; the `github:dispatch:<repo>/<workflow>`
 *   grant is enforced there against `(package_id, "production")`.
 * - `PULSE` — service binding to pulse for event emission.
 * - `PULSE_PROJECT_ID` / `PULSE_INGEST_KEY` / `PULSE_READ_KEY` — #158,
 *   OPTIONAL pulse observability (#158): plain var + two Secrets Store
 *   secrets, bound only when all three env vars are set. NOT part of the
 *   `require_deploy_secret` guard — unbound observability degrades to a
 *   no-op emitter + `not_configured` summary, never blocks deploys.
 * - `CF_API_TOKEN` — Secrets Store secret. Token with `Workers Scripts:Edit`
 *   on the orchestrator's account. Required by the production CloudflareProvider
 *   to upload versions + create deployments for the managed Workers.
 *   ALWAYS bound — the deploy guard at the top of this file refuses to
 *   deploy when either this or `PIPELINES_TOKEN` is missing from the
 *   env (a half-provisioned deploy silently deleted the secret and
 *   broke orchestration).
 * - `CF_ACCOUNT_ID` — plain var, the account the orchestrator deploys runs into.
 *
 * The Worker exports TWO entrypoints:
 *   - `default` (Hono fetch handler)
 *   - `PipelinesGrantsEndpoint` (RPC class consumed by vault)
 * Both are detected from `src/index.ts` at bundle upload time. The named
 * entrypoint is referenced by vault's `services[].entrypoint`.
 *
 * Carry-overs from vault deploy:
 *   - `rpc` is the default compat flag since 2024-04-03 — do NOT specify.
 *   - Account is capped at one Secrets Store. Adopt the auto-provisioned
 *     `default_secrets_store` (shared with vault on the same account). The
 *     boundary stays at the secret-name level: `CF_API_TOKEN` is only
 *     bound to this Worker.
 *   - Alchemy uses the OAuth `default` profile via `--profile default`
 *     (the limited `CLOUDFLARE_API_TOKEN` in devpad/.env is commented out).
 */

import alchemy from "alchemy";
import type { Bindings } from "alchemy/cloudflare";
import {
	D1Database,
	DurableObjectNamespace,
	R2Bucket,
	Secret,
	SecretsStore,
	Worker,
	WorkerRef,
} from "alchemy/cloudflare";

/**
 * Deploy guard (#155 follow-up): refuse to deploy unless BOTH secrets
 * are present in the env, BEFORE any resource is declared. A deploy
 * without `CF_API_TOKEN` silently DELETED the existing secret from the
 * Secrets Store and broke every orchestrated deploy — binding an
 * optional secret is not optional in practice, it's destructive
 * when half-provisioned. Fail loudly instead. (Throwing at module top
 * runs before Alchemy adopts/creates anything.)
 */
const require_deploy_secret = (key: string): string => {
	const value = process.env[key];
	if (value === undefined || value === "") {
		throw new Error(
			`refusing to deploy devpad-pipelines: ${key} is missing/empty in the env. ` +
				"Both CF_API_TOKEN and PIPELINES_TOKEN must be set (devpad/.env) — " +
				"deploying without them silently deletes the bound secret and breaks orchestration.",
		);
	}
	return value;
};
require_deploy_secret("CF_API_TOKEN");
require_deploy_secret("PIPELINES_TOKEN");

const app = await alchemy("devpad-pipelines");

// Phase 12/13.C: the orchestrator is a platform singleton. The
// `is_staging` conditional was removed — there is no `devpad-pipelines-staging`
// stage at runtime. The orchestrator deploys once against the production
// `devpad-unified-db` D1 + `devpad-corpus` R2. Stage scoping for upstream
// services is on `caller.environment` (vault grants) and on pulse event
// tags; the workload Workers themselves retain their per-stage names.
const worker_name = "devpad-pipelines";

const db = await D1Database("DB", {
	name: "devpad-unified-db",
	adopt: true,
});

const corpus = await R2Bucket("CORPUS_BUCKET", {
	name: "devpad-corpus",
	adopt: true,
});

const pipeline_runs = DurableObjectNamespace<unknown>("PIPELINE_RUNS", {
	className: "PipelineRunDO",
	sqlite: true,
});

// Secrets are ALWAYS bound — the deploy guard above aborts the deploy
// when either `CF_API_TOKEN` or `PIPELINES_TOKEN` is missing from the
// env, so no conditional wiring remains. A half-provisioned deploy
// silently deleted the `CF_API_TOKEN` secret yesterday and broke
// orchestrated deploys; unconditional binding + the guard is the fix.
//
// NOTE: the #158 pulse secrets below are the OPPOSITE regime — optional
// by design (unbound observability degrades to no-op emitter +
// `not_configured` summary, never blocks deploys). They bind
// conditionally on env presence. Trade-off consciously accepted: if the
// env vars disappear after having been bound once, the Secret resource
// drops and the binding is deleted — the same destructive path the
// guard protects CF_API_TOKEN from. Operators re-provisioning must keep
// the vars set, or re-set them before the next deploy.
//
// Cloudflare currently caps accounts at one Secrets Store. The account
// already has the auto-provisioned `default_secrets_store` (shared with
// vault on the same account). Adopt rather than fail on the cap.
const secrets_store = await SecretsStore("pipelines-secrets", {
	name: "default_secrets_store",
	adopt: true,
});
const cf_api_token = await Secret("CF_API_TOKEN", {
	name: "CF_API_TOKEN",
	store: secrets_store,
	value: alchemy.secret.env.CF_API_TOKEN,
});
const pipelines_token = await Secret("PIPELINES_TOKEN", {
	name: "PIPELINES_TOKEN",
	store: secrets_store,
	value: alchemy.secret.env.PIPELINES_TOKEN,
});

const github_vault_binding = { type: "service", service: "vault", __entrypoint__: "GitHubVault" };

const bindings: Bindings = {
	ENVIRONMENT: "production",
	DB: db,
	CORPUS_BUCKET: corpus,
	PIPELINE_RUNS: pipeline_runs,
	// Both service bindings target the vault Worker. `ANTHROPIC` binds
	// the module default export (no entrypoint field — setting one for a
	// default export triggers `entrypoint name not found`). `GITHUB`
	// binds the named `GitHubVault` entrypoint class, which requires the
	// documented `__entrypoint__` workaround: Alchemy's public
	// `WorkerRef()` factory drops the `entrypoint` field, so the binding
	// object is constructed directly. External-deploy CI dispatch (#155)
	// goes through it; the `github:dispatch:*` grant is enforced by
	// vault against `(package_id, "production")`.
	ANTHROPIC: WorkerRef({ service: "vault" }),
	GITHUB: github_vault_binding as ReturnType<typeof WorkerRef>,
	PULSE: WorkerRef({ service: "pulse-api" }),
	CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID ?? "81874bc21b868deba3276f551acde354",
	CF_API_TOKEN: cf_api_token,
	PIPELINES_TOKEN: pipelines_token,
};

// #158: pulse observability is OPTIONAL (never part of
// `require_deploy_secret`) — the emitter no-ops and the summary client
// returns `not_configured` when these are unbound. `PULSE_PROJECT_ID` is
// a plain var (never sensitive); the two keys adopt the same shared
// `default_secrets_store` as the required secrets above when set.
//   PULSE_PROJECT_ID — pulse project receiving orchestrator events (must
//                      match the project the ingest key is issued for).
//   PULSE_INGEST_KEY — `pk_*` plaintext for the `X-Pulse-Key` header.
//   PULSE_READ_KEY   — devpad API key (scope "pulse") for the bearer-auth
//                      query routes.
const pulse_project_id = process.env.PULSE_PROJECT_ID;

if (
	pulse_project_id !== undefined &&
	pulse_project_id !== "" &&
	process.env.PULSE_INGEST_KEY !== undefined &&
	process.env.PULSE_INGEST_KEY !== "" &&
	process.env.PULSE_READ_KEY !== undefined &&
	process.env.PULSE_READ_KEY !== ""
) {
	const pulse_ingest_key = await Secret("PULSE_INGEST_KEY", {
		name: "PULSE_INGEST_KEY",
		store: secrets_store,
		value: alchemy.secret.env.PULSE_INGEST_KEY,
	});
	const pulse_read_key = await Secret("PULSE_READ_KEY", {
		name: "PULSE_READ_KEY",
		store: secrets_store,
		value: alchemy.secret.env.PULSE_READ_KEY,
	});
	bindings.PULSE_PROJECT_ID = pulse_project_id;
	bindings.PULSE_INGEST_KEY = pulse_ingest_key;
	bindings.PULSE_READ_KEY = pulse_read_key;
}

export const worker = await Worker("pipelines", {
	name: worker_name,
	entrypoint: "./packages/pipelines/src/index.ts",
	compatibilityDate: "2026-05-01",
	compatibilityFlags: ["nodejs_compat"],
	observability: { enabled: true },
	url: true,
	adopt: true,
	bindings,
});

await app.finalize();
