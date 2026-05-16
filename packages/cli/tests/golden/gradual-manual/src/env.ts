/**
 * Typed environment bindings for gradual-manual.
 *
 * `ANTHROPIC` and `PULSE` are RPC service bindings — the Worker holds no
 * upstream credentials directly. All Anthropic traffic crosses the
 * security boundary into the vault Worker via the `ANTHROPIC` binding;
 * pulse receives observability events through `PULSE`.
 */

import type { WorkerEntrypoint } from "cloudflare:workers";

export type AnthropicVaultBinding = Service<WorkerEntrypoint<unknown>>;
export type PulseBinding = Fetcher;

export type Env = {
	ANTHROPIC: AnthropicVaultBinding;
	PULSE: PulseBinding;
};
