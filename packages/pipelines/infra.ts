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
 *
 * The Worker exports TWO entrypoints:
 *   - `default` (Hono fetch handler)
 *   - `PipelinesGrantsEndpoint` (RPC class consumed by vault)
 * Both are detected from `src/index.ts` at bundle upload time. The named
 * entrypoint is referenced by vault's `services[].entrypoint`.
 *
 * Carry-overs from vault deploy:
 *   - `rpc` is the default compat flag since 2024-04-03 — do NOT specify.
 *   - This Worker has NO Secrets bound, so no `default_secrets_store`
 *     adoption + no `ALCHEMY_PASSWORD` required.
 *   - Alchemy uses the OAuth `default` profile via `--profile default`
 *     (the limited `CLOUDFLARE_API_TOKEN` in devpad/.env is commented out).
 */

import alchemy from "alchemy";
import type { Bindings } from "alchemy/cloudflare";
import { D1Database, DurableObjectNamespace, R2Bucket, Worker, WorkerRef } from "alchemy/cloudflare";

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

const bindings: Bindings = {
	ENVIRONMENT: is_staging ? "staging" : "production",
	DB: db,
	CORPUS_BUCKET: corpus,
	PIPELINE_RUNS: pipeline_runs,
	ANTHROPIC: WorkerRef({ service: vault_service }),
	PULSE: WorkerRef({ service: pulse_service }),
};

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
