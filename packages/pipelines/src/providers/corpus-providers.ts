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

import type { BundleFetchError, BundlePayload, BundleProvider } from "@devpad/core/services/pipelines";
import type { AssetUpload, ModuleUpload, VersionBinding } from "@devpad/pipeline-fakes";
import { AssetManifest, BundleManifest } from "@devpad/pipeline-fakes";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { extendTemplate, PipelineTemplateSchema } from "@devpad/pipeline-templates";
import type { Backend, VersionSetManifest } from "@f0rbit/corpus";
import {
	err,
	ok,
	pipeline_template_store,
	type Result,
	VersionSetManifestSchema,
	version_set_store,
} from "@f0rbit/corpus";
import { z } from "zod";
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

// ---------------------------------------------------------------------------
// Directory-bundle provider — Phase 2.B
// ---------------------------------------------------------------------------

/**
 * Local extension of {@link VersionSetManifestSchema} that surfaces the
 * directory-bundle + assets references the corpus schema doesn't carry yet.
 *
 * TODO(corpus 0.7.0): once the upstream `VersionSetManifestSchema` learns
 * `builds.worker.bundle_manifest_ref?` and `builds.assets.manifest_ref?`
 * natively, drop this local override and read the fields directly off the
 * `VersionSetManifest` type. Deferred per Phase 2.B plan — avoids republishing
 * `@f0rbit/corpus` mid-feature.
 */
const VersionSetManifestWithBundleSchema = VersionSetManifestSchema.extend({
	builds: VersionSetManifestSchema.shape.builds.extend({
		worker: VersionSetManifestSchema.shape.builds.shape.worker.extend({
			bundle_manifest_ref: z.string().optional(),
		}),
		assets: VersionSetManifestSchema.shape.builds.shape.assets
			.unwrap()
			.extend({
				manifest_ref: z.string().optional(),
			})
			.optional(),
	}),
}).passthrough();

type VersionSetManifestWithBundle = z.infer<typeof VersionSetManifestWithBundleSchema>;

/**
 * Typed error union surfaced by {@link DirectoryBundleProvider.fetch}. Every
 * failure mode the corpus side can produce gets its own discriminator so the
 * caller can pattern-match without string-sniffing.
 *
 * - `version_set_missing` — no manifest stored at `version_set_id`.
 * - `bundle_unavailable` — manifest is malformed: neither `artifact_ref` nor
 *   `bundle_manifest_ref` present (or the legacy `artifact_ref` blob is gone).
 * - `bundle_manifest_missing` — manifest points at a `bundle_manifest_ref` but
 *   the referenced blob isn't in corpus.
 * - `bundle_manifest_invalid` — the referenced blob exists but doesn't parse
 *   against {@link BundleManifest}.
 * - `module_fetch_failed` — one of the per-module `content_artifact_ref`s
 *   couldn't be resolved from corpus.
 * - `asset_manifest_missing` / `asset_manifest_invalid` / `asset_fetch_failed`
 *   — same three failure modes, but for the `builds.assets.manifest_ref`
 *   side-channel.
 */
export type BundleProviderError =
	| { kind: "version_set_missing"; version_set_id: string }
	| { kind: "bundle_unavailable"; reason: string }
	| { kind: "bundle_manifest_missing"; ref: string }
	| { kind: "bundle_manifest_invalid"; ref: string; reason: string }
	| { kind: "module_fetch_failed"; ref: string; reason: string }
	| { kind: "asset_manifest_missing"; ref: string }
	| { kind: "asset_manifest_invalid"; ref: string; reason: string }
	| { kind: "asset_fetch_failed"; ref: string; reason: string };

/**
 * Read-side contract: resolve a stored version-set into either the legacy
 * single-file bundle or the new directory-bundle + optional asset upload
 * payload.
 *
 * Takes a `version_set_id` (the corpus snapshot version) rather than an
 * already-decoded {@link VersionSetManifest}, because the corpus snapshot
 * codec strips unknown fields on decode (`"strip"` mode). The Phase 2.B
 * `bundle_manifest_ref` + `assets.manifest_ref` extensions are present on the
 * stored bytes (corpus's `json_codec.encode` does `JSON.stringify(value)`
 * without schema validation) but invisible on the typed read path. The
 * directory provider re-parses through {@link VersionSetManifestWithBundleSchema}
 * to recover them.
 *
 * The `BundlePayload` it yields is the same type `deploy_stage` consumes via
 * `BundleProvider.get(input)` — verification phase (Phase 2 merge) collapsed
 * the two parallel interfaces. {@link make_corpus_bundle_provider_for_deploy}
 * adapts this provider to satisfy `BundleProvider` (decorates with default
 * bindings + compatibility flags and maps the typed error to
 * `BundleFetchError`).
 */
export interface DirectoryBundleProvider {
	fetch(version_set_id: string): Promise<Result<BundlePayload, BundleProviderError>>;
}

const fetch_bytes = async (backend: Backend, ref: string): Promise<Result<Uint8Array, string>> => {
	const handle = await backend.data.get(ref);
	if (!handle.ok) return err(`corpus data.get(${ref}) failed: ${handle.error.kind}`);
	const bytes = await handle.value.bytes();
	return ok(bytes);
};

const load_widened_manifest = async (
	backend: Backend,
	version_set_id: string,
): Promise<Result<VersionSetManifestWithBundle, BundleProviderError>> => {
	const meta = await backend.metadata.get("version-sets", version_set_id);
	if (!meta.ok) {
		return err({ kind: "version_set_missing", version_set_id });
	}
	const raw = await fetch_bytes(backend, meta.value.data_key);
	if (!raw.ok) {
		return err({ kind: "version_set_missing", version_set_id });
	}
	let text: string;
	try {
		text = new TextDecoder().decode(raw.value);
	} catch (e) {
		return err({ kind: "bundle_unavailable", reason: `manifest decode failed: ${String(e)}` });
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		return err({ kind: "bundle_unavailable", reason: `manifest json parse failed: ${String(e)}` });
	}
	const parsed = VersionSetManifestWithBundleSchema.safeParse(json);
	if (!parsed.success) {
		return err({ kind: "bundle_unavailable", reason: `manifest schema invalid: ${parsed.error.message}` });
	}
	return ok(parsed.data);
};

const parse_bundle_manifest = (ref: string, bytes: Uint8Array): Result<BundleManifest, BundleProviderError> => {
	let text: string;
	try {
		text = new TextDecoder().decode(bytes);
	} catch (e) {
		return err({ kind: "bundle_manifest_invalid", ref, reason: `decode failed: ${String(e)}` });
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		return err({ kind: "bundle_manifest_invalid", ref, reason: `json parse failed: ${String(e)}` });
	}
	const parsed = BundleManifest.safeParse(json);
	if (!parsed.success) {
		return err({ kind: "bundle_manifest_invalid", ref, reason: parsed.error.message });
	}
	return ok(parsed.data);
};

const parse_asset_manifest = (ref: string, bytes: Uint8Array): Result<AssetManifest, BundleProviderError> => {
	let text: string;
	try {
		text = new TextDecoder().decode(bytes);
	} catch (e) {
		return err({ kind: "asset_manifest_invalid", ref, reason: `decode failed: ${String(e)}` });
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		return err({ kind: "asset_manifest_invalid", ref, reason: `json parse failed: ${String(e)}` });
	}
	const parsed = AssetManifest.safeParse(json);
	if (!parsed.success) {
		return err({ kind: "asset_manifest_invalid", ref, reason: parsed.error.message });
	}
	return ok(parsed.data);
};

const hydrate_modules = async (
	backend: Backend,
	manifest: BundleManifest,
): Promise<Result<ModuleUpload[], BundleProviderError>> => {
	const out: ModuleUpload[] = [];
	for (const module of manifest.modules) {
		const bytes = await fetch_bytes(backend, module.content_artifact_ref);
		if (!bytes.ok) {
			return err({ kind: "module_fetch_failed", ref: module.content_artifact_ref, reason: bytes.error });
		}
		out.push({ name: module.name, mime_type: module.mime_type, content: bytes.value });
	}
	return ok(out);
};

const hydrate_assets = async (
	backend: Backend,
	manifest: AssetManifest,
): Promise<Result<AssetUpload[], BundleProviderError>> => {
	const out: AssetUpload[] = [];
	for (const asset of manifest.assets) {
		const bytes = await fetch_bytes(backend, asset.content_artifact_ref);
		if (!bytes.ok) {
			return err({ kind: "asset_fetch_failed", ref: asset.content_artifact_ref, reason: bytes.error });
		}
		out.push({
			path: asset.path,
			hash: asset.hash,
			size_bytes: asset.size_bytes,
			mime_type: asset.mime_type,
			content: bytes.value,
		});
	}
	return ok(out);
};

/**
 * Directory-aware bundle provider. Resolves a {@link VersionSetManifest} into
 * a {@link BundlePayload} discriminated union that `deploy_stage` can hand
 * straight to `cf.versions.upload`.
 *
 * Routing:
 *
 * - Manifest has `builds.worker.bundle_manifest_ref` → directory-bundle path:
 *     1. Fetch the `BundleManifest` blob from corpus.
 *     2. Validate against the {@link BundleManifest} Zod schema.
 *     3. Fan out and resolve each `module.content_artifact_ref` to bytes.
 *     4. If `builds.assets.manifest_ref` is also set: fetch + validate the
 *        `AssetManifest`, then fan out per-asset bytes the same way.
 *     5. Return `{ kind: "directory_bundle", modules, main_module, ..., assets? }`.
 *
 * - Manifest has only `builds.worker.artifact_ref` → legacy single-file path:
 *     1. Fetch the bundle blob from corpus.
 *     2. Return `{ kind: "single_file", bytes }`.
 *
 * - Manifest has BOTH `artifact_ref` and `bundle_manifest_ref` → directory
 *   wins. The manifest is in an inconsistent state (likely a mid-migration
 *   artifact); we prefer the newer field. The legacy ref is left unread.
 *
 * - Manifest has neither → `bundle_unavailable`.
 *
 * The provider emits the `BundlePayload` discriminated union shared with
 * `@devpad/core/services/pipelines`. Use {@link make_corpus_bundle_provider}
 * to get a `BundleProvider`-shaped wrapper that decorates the payload with
 * default bindings + compatibility flags and maps the typed
 * {@link BundleProviderError} to `BundleFetchError`.
 */
export const make_corpus_directory_bundle_provider = (backend: Backend): DirectoryBundleProvider => ({
	fetch: async (version_set_id: string): Promise<Result<BundlePayload, BundleProviderError>> => {
		const widened_result = await load_widened_manifest(backend, version_set_id);
		if (!widened_result.ok) return widened_result;
		const widened = widened_result.value;
		const bundle_manifest_ref = widened.builds.worker.bundle_manifest_ref;
		const artifact_ref = widened.builds.worker.artifact_ref;

		if (bundle_manifest_ref !== undefined && bundle_manifest_ref !== "") {
			const manifest_bytes = await fetch_bytes(backend, bundle_manifest_ref);
			if (!manifest_bytes.ok) {
				return err({ kind: "bundle_manifest_missing", ref: bundle_manifest_ref });
			}
			const parsed = parse_bundle_manifest(bundle_manifest_ref, manifest_bytes.value);
			if (!parsed.ok) return parsed;

			const modules = await hydrate_modules(backend, parsed.value);
			if (!modules.ok) return modules;

			const assets_ref = widened.builds.assets?.manifest_ref;
			if (assets_ref !== undefined && assets_ref !== "") {
				const asset_bytes = await fetch_bytes(backend, assets_ref);
				if (!asset_bytes.ok) {
					return err({ kind: "asset_manifest_missing", ref: assets_ref });
				}
				const asset_manifest = parse_asset_manifest(assets_ref, asset_bytes.value);
				if (!asset_manifest.ok) return asset_manifest;

				const assets = await hydrate_assets(backend, asset_manifest.value);
				if (!assets.ok) return assets;

				return ok({
					kind: "directory_bundle",
					modules: modules.value,
					main_module: parsed.value.main_module,
					compatibility_date: parsed.value.compatibility_date,
					compatibility_flags: parsed.value.compatibility_flags,
					assets: { assets: assets.value, config: asset_manifest.value.config },
				});
			}

			return ok({
				kind: "directory_bundle",
				modules: modules.value,
				main_module: parsed.value.main_module,
				compatibility_date: parsed.value.compatibility_date,
				compatibility_flags: parsed.value.compatibility_flags,
			});
		}

		if (artifact_ref !== undefined && artifact_ref !== "") {
			const bytes = await fetch_bytes(backend, artifact_ref);
			if (!bytes.ok) {
				return err({ kind: "bundle_unavailable", reason: bytes.error });
			}
			return ok({ kind: "single_file", bytes: bytes.value });
		}

		return err({
			kind: "bundle_unavailable",
			reason: "manifest has neither builds.worker.artifact_ref nor builds.worker.bundle_manifest_ref",
		});
	},
});

/**
 * Production `BundleProvider` factory consumed by `deps.ts`. Wraps the
 * underlying directory-aware {@link DirectoryBundleProvider} so it satisfies
 * the `BundleProvider.get(input)` interface `deploy_stage` consumes.
 *
 * Decorates every payload with:
 *  - `bindings`: orchestrator-managed defaults (vault + pulse service
 *    bindings) supplied via `bindings_for`. The caller-identity `CALLER_*`
 *    trio is stamped downstream in `deploy_stage`.
 *  - `compatibility_flags`: only stamped on the `single_file` branch when the
 *    manifest's `builds.worker` field doesn't carry flags. Directory bundles
 *    carry their own flags from `BundleManifest`, so we leave those alone.
 *
 * Errors from the directory provider's `BundleProviderError` union collapse to
 * the public `bundle_unavailable` `BundleFetchError`, with the typed
 * discriminator and any contextual fields encoded into the message — the
 * wire-side never sees the internal kinds, only the public code.
 */
export const make_corpus_bundle_provider = (
	backend: Backend,
	options: {
		bindings_for?: (input: { package_name: string; environment: "staging" | "production" }) => VersionBinding[];
		compatibility_flags?: string[];
	} = {},
): BundleProvider => {
	const directory = make_corpus_directory_bundle_provider(backend);
	return {
		get: async (input): Promise<Result<BundlePayload, BundleFetchError>> => {
			const result = await directory.fetch(input.version_set_id);
			if (!result.ok) {
				return err({ code: "bundle_unavailable", message: format_bundle_provider_error(result.error) });
			}
			const bindings =
				options.bindings_for?.({ package_name: input.package_name, environment: input.environment }) ?? [];
			if (result.value.kind === "single_file") {
				return ok({
					...result.value,
					compatibility_flags: result.value.compatibility_flags ?? options.compatibility_flags,
					bindings,
				});
			}
			return ok({ ...result.value, bindings });
		},
	};
};

const format_bundle_provider_error = (error: BundleProviderError): string => {
	switch (error.kind) {
		case "version_set_missing":
			return `version_set_missing: ${error.version_set_id}`;
		case "bundle_unavailable":
			return `bundle_unavailable: ${error.reason}`;
		case "bundle_manifest_missing":
			return `bundle_manifest_missing: ${error.ref}`;
		case "bundle_manifest_invalid":
			return `bundle_manifest_invalid: ${error.ref} (${error.reason})`;
		case "module_fetch_failed":
			return `module_fetch_failed: ${error.ref} (${error.reason})`;
		case "asset_manifest_missing":
			return `asset_manifest_missing: ${error.ref}`;
		case "asset_manifest_invalid":
			return `asset_manifest_invalid: ${error.ref} (${error.reason})`;
		case "asset_fetch_failed":
			return `asset_fetch_failed: ${error.ref} (${error.reason})`;
	}
};
