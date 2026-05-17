/**
 * Typed environment bindings for gradual-analysis.
 *
 * `ANTHROPIC` and `PULSE` are RPC service bindings — the Worker holds no
 * upstream credentials directly. All Anthropic traffic crosses the
 * security boundary into the vault Worker via the `ANTHROPIC` binding;
 * pulse receives observability events through `PULSE`.
 *
 * The `AnthropicMessage*` types mirror vault's RPC contract (duplicated
 * here so this package stays decoupled from the vault workspace).
 */

import type { Result } from "@f0rbit/corpus";

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

export type VaultError =
	| { kind: "identity_missing"; message: string; field: string }
	| { kind: "grant_denied"; scope: string; reason?: string }
	| { kind: "grant_check_failed"; message: string }
	| { kind: "upstream_error"; cause: { kind: string; message: string } };

export interface AnthropicVaultBinding {
	messages_create(input: AnthropicMessageInput): Promise<Result<AnthropicMessage, VaultError>>;
	messages: {
		create(input: AnthropicMessageInput): Promise<Result<AnthropicMessage, VaultError>>;
	};
}

export type PulseBinding = Fetcher;

export type Env = {
	ANTHROPIC: AnthropicVaultBinding;
	PULSE: PulseBinding;
	ENVIRONMENT: "staging" | "production";
};
