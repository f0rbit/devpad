/**
 * @module core/services/pipelines/bindings
 *
 * Pure binding-merge logic for orchestrated promotions (#160).
 *
 * Cloudflare treats `metadata.bindings` on a version upload as the
 * COMPLETE binding set for the new version. The orchestrator used to
 * stamp only the platform set (vault `ANTHROPIC`, `PULSE` + the
 * `CALLER_*` identity vars), silently dropping every package-owned
 * binding (D1, R2, Queue, Workers AI, plain vars, …) declared in the
 * package's own alchemy infra.
 *
 * The fix (#160): before every upload the orchestrator reads the
 * bindings of the versions currently ACTIVE on the target script
 * (deployments → active deployment → its versions → version bindings)
 * and merges:
 *
 *   final = [live bindings minus secrets minus platform names] ++ platform
 *
 * Rules implemented here:
 *
 * - **Pass-through**: unknown/non-platform binding types (d1, r2_bucket,
 *   queue, ai, kv_namespace, service, durable_object_namespace,
 *   vectorize, workflow, analytics_engine, json, …) are preserved
 *   verbatim, extra fields included. A type we don't model is never
 *   dropped.
 * - **Platform wins by name**: any live binding whose `name` matches a
 *   deliberately-supplied platform binding / identity var is replaced
 *   (never duplicated).
 * - **No duplicates**: live entries dedupe by `name` (last read wins —
 *   versions are read per active deployment entry in strategy order, so
 *   the highest-percentage live version wins ties); upload-supplied
 *   entries are appended after and therefore win any residual collision.
 * - **Secrets ride `keep_bindings`**: `secret_text` / `secret_key`
 *   bindings come back WITHOUT values (Cloudflare strips them on read),
 *   so they cannot be re-sent. They are removed from the explicit list
 *   and their TYPES are emitted as `keep_bindings` — which Cloudflare
 *   resolves against the script's LATEST version. That inheritance
 *   source is fine in practice: every orchestrated upload preserves
 *   secrets too, so the latest version always carries the same secret
 *   set.
 */

import type { VersionBinding } from "@devpad/pipeline-fakes";

/**
 * Binding types whose values Cloudflare strips from reads. They must be
 * inherited via `metadata.keep_bindings` rather than re-sent.
 */
export const SECRET_BINDING_TYPES = ["secret_text", "secret_key"] as const;

export type BindingMergeInput = {
	/** Bindings read from the script's live (active) version(s). */
	live: VersionBinding[];
	/** Bindings the orchestrator deliberately supplies: the platform set
	 * (vault/pulse service bindings) plus the identity vars as bindings.
	 * These win any name collision and are never carried over from live. */
	platform: VersionBinding[];
};

export type MergedBindings = {
	/** Explicit bindings for the upload's `metadata.bindings` (secrets removed). */
	bindings: VersionBinding[];
	/** Binding TYPES to inherit via `metadata.keep_bindings`. Empty when
	 * the live set has no secret bindings — the metadata field is then
	 * omitted entirely. */
	keep_bindings: string[];
};

const is_secret_binding = (binding: VersionBinding): boolean =>
	(SECRET_BINDING_TYPES as readonly string[]).includes(binding.type);

export const merge_bindings = (input: BindingMergeInput): MergedBindings => {
	const platform_names = new Set(input.platform.map((b) => b.name));
	const keep_bindings = new Set<string>();

	// Dedupe live by name, LAST occurrence wins; drop secrets (they go to
	// keep_bindings) and platform-owned names (the fresh set replaces them).
	const carried = new Map<string, VersionBinding>();
	for (const binding of input.live) {
		if (is_secret_binding(binding)) {
			keep_bindings.add(binding.type);
			continue;
		}
		if (platform_names.has(binding.name)) continue;
		carried.set(binding.name, binding);
	}

	return {
		bindings: [...carried.values(), ...input.platform],
		keep_bindings: [...keep_bindings],
	};
};
