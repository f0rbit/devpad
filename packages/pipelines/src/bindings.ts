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
 * Vault is bound as a service binding; we type it as `Fetcher` for now
 * since `~/dev/vault` is a separate repo and we don't have its types
 * published yet. Phase 2 will swap this for a structurally-typed
 * entrypoint once vault gains its first RPC method.
 */

import type { D1Database, DurableObjectNamespace, Fetcher, R2Bucket } from "@cloudflare/workers-types";

export type PipelineEnv = {
	DB: D1Database;
	CORPUS_BUCKET: R2Bucket;
	PIPELINE_RUNS: DurableObjectNamespace;
	// Phase 2 will swap Fetcher for the typed vault entrypoint.
	// TODO(phase-2): import type from `vault` once it publishes its
	// RPC surface.
	ANTHROPIC: Fetcher;
	PULSE: Fetcher;
	ENVIRONMENT: "development" | "staging" | "production";
};
