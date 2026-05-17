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
import { version_set_store } from "@f0rbit/corpus";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { extendTemplate } from "@devpad/pipeline-templates";
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
 * Resolve a package's pipeline template. Until template-storage lands
 * (`default_template_ref` is currently always null), we fall back to
 * the built-in default gradual template — pipelines deployed today
 * have not customised their rollout via the DSL.
 *
 * Reserved: once a template-storage layer exists (Phase 4+), this
 * resolver will load the template body from corpus and run it through
 * `extendTemplate` to produce the typed {@link PipelineTemplate}.
 */
export const make_default_template_resolver = (): TemplateResolver => {
	const built = extendTemplate({});
	if (!built.ok) throw new Error(`default template build failed: ${JSON.stringify(built.error)}`);
	const template: PipelineTemplate = built.value;
	return {
		resolve: async (_package_id: string): Promise<PipelineTemplate | null> => template,
	};
};
