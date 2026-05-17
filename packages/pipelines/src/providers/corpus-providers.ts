/**
 * @module pipelines/providers/corpus-providers
 *
 * Production wirings for the orchestrator's read-side providers:
 *
 * - {@link make_corpus_manifest_provider} — reads a
 *   {@link VersionSetManifest} by `version_set_id` (the corpus snapshot
 *   `version`) via `corpus.version_set_store`.
 * - {@link make_corpus_lineage_provider} — walks the corpus lineage chain
 *   for a given version-set, returning the immediate parent's version
 *   (or `null` for the first version of a package).
 *
 * The orchestrator's POST /runs handler calls both. Tests inject the
 * in-memory backend; production injects the D1+R2-backed
 * `create_cloudflare_backend`.
 */

import type { Backend, VersionSetManifest } from "@f0rbit/corpus";
import { ok, err, pipeline_template_store, type Result, version_set_store } from "@f0rbit/corpus";
import type { BundleFetchError, BundlePayload, BundleProvider } from "@devpad/core/services/pipelines";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { extendTemplate, PipelineTemplateSchema } from "@devpad/pipeline-templates";
import type { VersionBinding } from "@devpad/pipeline-fakes";
import type { LineageProvider, ManifestProvider, TemplateResolver } from "../routes.ts";

/**
 * Read the full {@link VersionSetManifest} body keyed by the corpus
 * snapshot version. Returns `null` for any read error (missing version,
 * codec failure, backend down) — the route maps null → 404.
 */
export const make_corpus_manifest_provider = (backend: Backend): ManifestProvider => {
	const store = version_set_store(backend);
	return {
		get: async (version_set_id: string): Promise<VersionSetManifest | null> => {
			const result = await store.store.get(version_set_id);
			if (!result.ok) return null;
			return result.value.data;
		},
	};
};

/**
 * Walk lineage backwards from the given `version_set_id`. The current
 * version is the head of the chain (index 0); the previous version
 * (index 1) is what we hand to the state machine for rollback.
 *
 * `package_id` is currently unused — the corpus stores all packages in
 * the same `version-sets` store and lineage is per-snapshot, not
 * per-package. Reserved for future filtering.
 */
export const make_corpus_lineage_provider = (backend: Backend): LineageProvider => {
	const store = version_set_store(backend);
	return {
		previous: async (_package_id: string, version_set_id: string): Promise<string | null> => {
			const result = await store.lineage(version_set_id);
			if (!result.ok) return null;
			const chain = result.value;
			if (chain.length < 2) return null;
			return chain[1].version;
		},
	};
};

/**
 * Resolve a package's pipeline template by reading the
 * `template_ref` off the version-set manifest and loading the
 * corresponding `pipeline-templates` corpus blob.
 *
 * The CLI compiles a package's `pipeline.ts` to JSON at upload time
 * (`compile_pipeline_ts`) and uploads the blob to
 * `pipeline-templates/<content_hash>`. The version-set manifest is
 * stamped with `template_ref = "pipeline-templates/<content_hash>"`.
 * At run-start the orchestrator:
 *
 *   1. reads the manifest by `version_set_id`,
 *   2. extracts `template_ref`,
 *   3. fetches the JSON blob via the corpus store,
 *   4. validates against `PipelineTemplateSchema` and returns the
 *      typed result.
 *
 * Backward compat: manifests written before this feature shipped will
 * have `template_ref === undefined`. Those resolve via the built-in
 * `extendTemplate({})` default — the gradual template every pre-5.D
 * package implicitly used. Without this fallback, in-flight runs from
 * the pre-Phase-5 era would 404 at run-start.
 */
export const make_corpus_template_resolver = (backend: Backend, manifests: ManifestProvider): TemplateResolver => {
	const version_sets = version_set_store(backend);
	const templates = pipeline_template_store(backend, PipelineTemplateSchema);

	const default_built = extendTemplate({});
	if (!default_built.ok) throw new Error(`default template build failed: ${JSON.stringify(default_built.error)}`);
	const default_template: PipelineTemplate = default_built.value;

	return {
		resolve: async (_package_id: string, version_set_id: string): Promise<PipelineTemplate | null> => {
			const manifest = await manifests.get(version_set_id);
			if (manifest === null) {
				// No manifest means an unknown version_set — let the route
				// surface its own 404. Returning the default would mask the
				// upstream error.
				return null;
			}
			if (manifest.template_ref === undefined || manifest.template_ref === "") {
				return default_template;
			}
			const content_hash = extract_template_content_hash(manifest.template_ref);
			if (content_hash === null) {
				return default_template;
			}
			// `template_ref` is `pipeline-templates/<content_hash>` (the
			// `data_key` the CLI received from `POST /artifacts/blob`). The
			// corpus snapshot is keyed by `version`, not content_hash, so we
			// resolve via `find_by_hash` and then load the typed body
			// through the store.
			const meta = await backend.metadata.find_by_hash("pipeline-templates", content_hash);
			if (meta === null) {
				return null;
			}
			const result = await templates.get(meta.version);
			if (!result.ok) {
				return null;
			}
			return result.value.data;
		},
	};
};

/**
 * Production bundle provider — resolves `version_set_id` to the
 * compiled Worker bundle bytes the orchestrator needs for a multipart
 * upload. Path:
 *
 *   1. Read the version-set manifest by version (corpus snapshot key).
 *   2. Pull `manifest.builds.worker.artifact_ref` (e.g.
 *      `worker-bundles/<content_hash>`) out of the manifest.
 *   3. Fetch the raw bytes via `backend.data.get(artifact_ref).bytes()`.
 *
 * `bindings_for` lets the caller supply environment-specific bindings
 * (e.g. `ANTHROPIC` -> `vault-staging` vs `vault-production`). The
 * caller-identity trio is added downstream in `deploy_stage`; only the
 * non-`plain_text` bindings flow through here.
 *
 * Phase 6 caveat: the manifest does NOT yet carry the package's
 * declared bindings (service / kv / DO / secrets) — Phase 7 will add a
 * `builds.worker.metadata` field to the manifest and surface it here.
 * Today this provider returns only the bundle bytes; the caller
 * supplements with the CALLER_* trio (computed in deploy_stage) and
 * the orchestrator-side default bindings via `bindings_for`.
 */
export const make_corpus_bundle_provider = (
	backend: Backend,
	manifests: ManifestProvider,
	options: {
		bindings_for?: (input: { package_name: string; environment: "staging" | "production" }) => VersionBinding[];
		compatibility_flags?: string[];
	} = {},
): BundleProvider => ({
	get: async (input): Promise<Result<BundlePayload, BundleFetchError>> => {
		const manifest = await manifests.get(input.version_set_id);
		if (manifest === null) {
			return err({ code: "bundle_unavailable", message: `no version-set manifest found for ${input.version_set_id}` });
		}
		const artifact_ref = manifest.builds?.worker?.artifact_ref;
		if (artifact_ref === undefined || artifact_ref === "") {
			return err({ code: "bundle_unavailable", message: `manifest for ${input.version_set_id} has no builds.worker.artifact_ref` });
		}
		const handle_result = await backend.data.get(artifact_ref);
		if (!handle_result.ok) {
			return err({ code: "bundle_unavailable", message: `corpus data.get(${artifact_ref}) failed: ${handle_result.error.kind}` });
		}
		const bytes = await handle_result.value.bytes();
		const bindings = options.bindings_for?.({ package_name: input.package_name, environment: input.environment }) ?? [];
		return ok({
			bytes,
			compatibility_date: manifest.builds.worker.compatibility_date,
			compatibility_flags: options.compatibility_flags,
			bindings,
		});
	},
});

const extract_template_content_hash = (template_ref: string): string | null => {
	// The CLI emits the namespaced form `pipeline-templates/<content_hash>`
	// (matches the `data_key` returned by `/artifacts/blob`). Accept the
	// bare form too for robustness against ref-format drift.
	if (template_ref.includes("/")) {
		const parts = template_ref.split("/");
		const tail = parts[parts.length - 1];
		return tail !== undefined && tail !== "" ? tail : null;
	}
	return template_ref === "" ? null : template_ref;
};
