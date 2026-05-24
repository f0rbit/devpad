/**
 * @module @devpad/cli/corpus-backend
 *
 * Selector for the corpus backend used by the CLI's artifact upload
 * flow.
 *
 * Two modes:
 * - `memory`           — in-memory; used by unit tests + offline `devpad
 *   pipelines artifacts upload` (no token/URL → falls back here).
 * - `cloudflare-http`  — HTTP backend pointing at the deployed
 *   orchestrator's `/artifacts/*` routes; selected automatically when
 *   `DEVPAD_PIPELINES_URL` + `DEVPAD_PIPELINES_TOKEN` are both set, or
 *   explicitly via `{ mode: "cloudflare-http", pipelines_url,
 *   pipelines_token }`.
 *
 * Both modes return a corpus `Backend` so the rest of the upload code
 * (the `version_set_store(backend).put(manifest)` path) is mode-agnostic.
 */

import type { Backend } from "@f0rbit/corpus";
import { create_memory_backend } from "@f0rbit/corpus";
import { create_corpus_http_backend } from "./corpus-http-backend.ts";

export type CorpusBackendMode = "memory" | "cloudflare-http";

export type SelectCorpusBackendInput = {
	mode?: CorpusBackendMode;
	pipelines_url?: string;
	pipelines_token?: string;
};

const resolve_env = (input: SelectCorpusBackendInput): { url: string | null; token: string | null } => {
	const url = input.pipelines_url ?? process.env.DEVPAD_PIPELINES_URL ?? null;
	const token = input.pipelines_token ?? process.env.DEVPAD_PIPELINES_TOKEN ?? null;
	return {
		url: url === "" ? null : url,
		token: token === "" ? null : token,
	};
};

export const selectCorpusBackend = async (input: SelectCorpusBackendInput = {}): Promise<Backend> => {
	const { url, token } = resolve_env(input);
	const explicit_mode = input.mode;
	const auto_mode: CorpusBackendMode = url !== null && token !== null ? "cloudflare-http" : "memory";
	const mode = explicit_mode ?? auto_mode;

	if (mode === "cloudflare-http") {
		if (url === null || token === null) {
			throw new Error("cloudflare-http mode requires DEVPAD_PIPELINES_URL + DEVPAD_PIPELINES_TOKEN (env or input)");
		}
		return create_corpus_http_backend({ pipelines_url: url, pipelines_token: token });
	}
	return create_memory_backend();
};

/**
 * @deprecated Use {@link selectCorpusBackend} — keeps backwards-compat
 * with the previous CLI entry point. Always returns the memory
 * backend; new callers should prefer the auto-detecting selector.
 */
export const createCorpusBackend = async (): Promise<Backend> => create_memory_backend();
