/**
 * Alchemy IaC for the pipelines orchestrator Worker.
 *
 * Bindings:
 * - `DB` — devpad's existing D1 (shared with apps/main). Adopted, NOT created.
 *   Production: devpad-unified-db, Staging: devpad-unified-db-preview.
 * - `CORPUS_BUCKET` — existing R2 bucket. Adopted.
 * - `PIPELINE_RUNS` — Durable Object namespace bound to `PipelineRunDO`
 *   (SQLite-backed; migration tag v1).
 * - `ANTHROPIC` — service binding to vault Worker (RPC entrypoint `AnthropicVault`).
 * - `PULSE` — service binding to pulse for event emission.
 * - `CF_API_TOKEN` — Secrets Store secret. Token with `Workers Scripts:Edit`
 *   on the orchestrator's account. Required by the production CloudflareProvider
 *   to upload versions + create deployments for the managed Workers.
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
import { D1Database, DurableObjectNamespace, R2Bucket, Secret, SecretsStore, Worker, WorkerRef } from "alchemy/cloudflare";

const app = await alchemy("devpad-pipelines");

const stage = app.stage;
const is_staging = stage === "staging";

const worker_name = is_staging ? "devpad-pipelines-staging" : "devpad-pipelines";
const d1_name = is_staging ? "devpad-unified-db-preview" : "devpad-unified-db";
const r2_name = is_staging ? "devpad-corpus-staging" : "devpad-corpus";
const vault_service = is_staging ? "vault-staging" : "vault-production";
const pulse_service = is_staging ? "pulse-api-staging" : "pulse-api-production";

const db = await D1Database("DB", {
	name: d1_name,
	adopt: true,
});

const corpus = await R2Bucket("CORPUS_BUCKET", {
	name: r2_name,
	adopt: true,
});

const pipeline_runs = DurableObjectNamespace<unknown>("PIPELINE_RUNS", {
	className: "PipelineRunDO",
	sqlite: true,
});

// CF API token binding is gated on `CF_API_TOKEN` being present in the
// deploy env. The Worker exports `RoutesDeps`/`RunDeps` factories that
// lazy-read the secret, so a deploy without it still serves
// `GET /runs` / read-only routes — pipeline runs that need CF API
// (`POST /runs/:id/advance`) will fail at the deploy step until the
// secret is bound. This lets pass-1 ship the wiring without blocking on
// token provisioning. Pass 2 (after the token lands in `.env`) binds it.
//
// Cloudflare currently caps accounts at one Secrets Store. The account
// already has the auto-provisioned `default_secrets_store` (shared with
// vault on the same account). Adopt rather than fail on the cap.
const wire_cf_token = Boolean(process.env.CF_API_TOKEN);

const bindings: Bindings = {
	ENVIRONMENT: is_staging ? "staging" : "production",
	DB: db,
	CORPUS_BUCKET: corpus,
	PIPELINE_RUNS: pipeline_runs,
	ANTHROPIC: WorkerRef({ service: vault_service }),
	PULSE: WorkerRef({ service: pulse_service }),
	CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID ?? "81874bc21b868deba3276f551acde354",
};

if (wire_cf_token) {
	const secrets_store = await SecretsStore("pipelines-secrets", {
		name: "default_secrets_store",
		adopt: true,
	});
	const cf_api_token = await Secret("CF_API_TOKEN", {
		name: "CF_API_TOKEN",
		store: secrets_store,
		value: alchemy.secret.env.CF_API_TOKEN,
	});
	bindings.CF_API_TOKEN = cf_api_token;
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
