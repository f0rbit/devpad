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
 * Vault is bound as a service binding with RPC entrypoint `AnthropicVault`.
 * The types below duplicate vault's contract from `~/dev/vault/src/types.ts`.
 * Until vault publishes a shared types package, both repos must update these
 * in lockstep if the Anthropic messages RPC contract changes.
 */

import type { D1Database, DurableObjectNamespace, Fetcher, R2Bucket } from "@cloudflare/workers-types";
import type { Result } from "@f0rbit/corpus";

// ─── Vault RPC contract (mirrored from ~/dev/vault/src/types.ts) ─────

export type AnthropicMessageInput = {
	model: string;
	system?: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
	max_tokens?: number;
	temperature?: number;
};

export type AnthropicMessage = {
	id: string;
	model: string;
	role: "assistant";
	content: string;
	stop_reason: "end_turn" | "max_tokens";
	usage: { input_tokens: number; output_tokens: number };
};

export type AnthropicError =
	| { kind: "rate_limited"; status: 429; message: string; retry_after_ms?: number }
	| { kind: "unauthorized"; status: 401; message: string }
	| { kind: "validation"; status: 400; message: string }
	| { kind: "internal"; status: number; message: string }
	| { kind: "network"; message: string }
	| { kind: "decode"; message: string };

export type VaultError =
	| { kind: "identity_missing"; message: string; field: keyof AnthropicMessageInput }
	| { kind: "grant_denied"; scope: string; reason?: string }
	| { kind: "grant_check_failed"; message: string }
	| { kind: "upstream_error"; cause: AnthropicError };

export interface AnthropicVaultRPC {
	messages_create(input: AnthropicMessageInput): Promise<Result<AnthropicMessage, VaultError>>;
	messages: {
		create(input: AnthropicMessageInput): Promise<Result<AnthropicMessage, VaultError>>;
	};
}

// ─── Environment type ───────────────────────────────────────────────

export type PipelineEnv = {
	DB: D1Database;
	CORPUS_BUCKET: R2Bucket;
	PIPELINE_RUNS: DurableObjectNamespace;
	// ANTHROPIC bound to vault Worker via RPC service binding.
	// Callers use `await env.ANTHROPIC.messages.create(...)` or
	// `await env.ANTHROPIC.messages_create(...)` — both resolve to the same handler.
	ANTHROPIC: Fetcher & AnthropicVaultRPC;
	PULSE: Fetcher;
	ENVIRONMENT: "development" | "staging" | "production";
};
