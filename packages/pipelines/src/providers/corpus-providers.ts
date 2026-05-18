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
import { ok, err, pipeline_template_store, type Result, version_set_store, VersionSetManifestSchema } from "@f0rbit/corpus";
import type { BundleFetchError, BundlePayload, BundleProvider } from "@devpad/core/services/pipelines";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { extendTemplate, PipelineTemplateSchema } from "@devpad/pipeline-templates";
import type { VersionBinding } from "@devpad/pipeline-fakes";
import { AssetManifest, BundleManifest } from "@devpad/pipeline-fakes";
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
 * `bindings_for` lets the caller supply environment-specific bindings.
 * After Phase 12 platform services (vault, pulse) are singletons, so
 * `bindings_for` returns the same service names regardless of
 * environment — `caller.environment` on RPC identity is the stage marker,
 * not the upstream Worker name. The caller-identity trio is added
 * downstream in `deploy_stage`; only the non-`plain_text` bindings flow
 * through here.
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
		assets: VersionSetManifestSchema.shape.builds.shape.assets.unwrap()
			.extend({
				manifest_ref: z.string().optional(),
			})
			.optional(),
	}),
}).passthrough();

type VersionSetManifestWithBundle = z.infer<typeof VersionSetManifestWithBundleSchema>;

/**
 * Wire-level MIME types accepted on a directory-bundle module part.
 * Mirrors Phase 2.A's {@link import("@devpad/pipeline-fakes").UploadVersionInput}
 * (`ModuleUpload.mime_type`) — independently declared so this worktree
 * compiles before Phase 2.A merges.
 */
export type ModuleMimeType =
	| "application/javascript+module"
	| "application/javascript"
	| "application/wasm"
	| "application/octet-stream"
	| "text/plain"
	| "text/x-python"
	| "text/x-python-requirement";

/**
 * One module file resolved from the corpus bundle manifest, ready to hand to
 * `cf.versions.upload({ kind: "directory_bundle", modules, ... })`.
 *
 * Mirrors Phase 2.A's `ModuleUpload` shape exactly (field-by-field). The two
 * worktrees declare structurally identical types so the verification phase can
 * collapse them into a single import without breaking either branch
 * in-isolation.
 */
export type ModuleUpload = {
	name: string;
	mime_type: ModuleMimeType;
	content: Uint8Array;
};

/**
 * One static-asset file resolved from the corpus asset manifest.
 *
 * `hash` is the BLAKE3-truncated value CF's content-addressed asset store
 * expects on both the upload-session manifest and the per-bucket multipart
 * body. It travels through unchanged from the corpus `AssetPart`.
 */
export type AssetUpload = {
	path: string;
	hash: string;
	size_bytes: number;
	mime_type: string;
	content: Uint8Array;
};

/**
 * Optional CF-side asset serving config carried verbatim through to
 * `metadata.assets.config` on `cf.versions.upload`. Mirrors Phase 2.A's
 * `AssetConfig` exactly.
 */
export type AssetConfig = {
	html_handling?: "auto-trailing-slash" | "force-trailing-slash" | "drop-trailing-slash" | "none";
	not_found_handling?: "404-page" | "single-page-application" | "none";
	run_worker_first?: boolean;
};

/**
 * Discriminated union returned by the directory-aware corpus bundle provider.
 * Mirrors the two `UploadVersionInput.kind` branches the CF API provider
 * accepts so the orchestrator can forward `BundleProviderResult` straight to
 * `cf.versions.upload(...)` once Phase 2.A + 2.B merge.
 *
 * - `single_file` — the legacy bundle-as-Uint8Array path. The manifest carries
 *   `builds.worker.artifact_ref` and no `bundle_manifest_ref`. Used by every
 *   `anthropic-*` package today.
 * - `directory_bundle` — the new multi-module path. The manifest carries
 *   `builds.worker.bundle_manifest_ref` (and optionally
 *   `builds.assets.manifest_ref`). Used by Astro/Remix/etc.
 */
export type BundleProviderResult =
	| { kind: "single_file"; bundle: Uint8Array }
	| {
		kind: "directory_bundle";
		modules: ModuleUpload[];
		main_module: string;
		compatibility_date: string;
		compatibility_flags: string[];
		assets?: {
			assets: AssetUpload[];
			config?: AssetConfig;
		};
	};

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
 * Phase 2.B-only interface — parallel to the existing
 * `BundleProvider.get(input)` shape in `@devpad/core/services/pipelines`. The
 * verification phase reconciles by switching `deploy_stage` to consume
 * {@link BundleProviderResult} directly.
 */
export interface DirectoryBundleProvider {
	fetch(version_set_id: string): Promise<Result<BundleProviderResult, BundleProviderError>>;
}

const fetch_bytes = async (backend: Backend, ref: string): Promise<Result<Uint8Array, string>> => {
	const handle = await backend.data.get(ref);
	if (!handle.ok) return err(`corpus data.get(${ref}) failed: ${handle.error.kind}`);
	const bytes = await handle.value.bytes();
	return ok(bytes);
};

const load_widened_manifest = async (backend: Backend, version_set_id: string): Promise<Result<VersionSetManifestWithBundle, BundleProviderError>> => {
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

const hydrate_modules = async (backend: Backend, manifest: BundleManifest): Promise<Result<ModuleUpload[], BundleProviderError>> => {
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

const hydrate_assets = async (backend: Backend, manifest: AssetManifest): Promise<Result<AssetUpload[], BundleProviderError>> => {
	const out: AssetUpload[] = [];
	for (const asset of manifest.assets) {
		const bytes = await fetch_bytes(backend, asset.content_artifact_ref);
		if (!bytes.ok) {
			return err({ kind: "asset_fetch_failed", ref: asset.content_artifact_ref, reason: bytes.error });
		}
		out.push({ path: asset.path, hash: asset.hash, size_bytes: asset.size_bytes, mime_type: asset.mime_type, content: bytes.value });
	}
	return ok(out);
};

/**
 * Directory-aware bundle provider. Resolves a {@link VersionSetManifest} into
 * a {@link BundleProviderResult} discriminated union that `deploy_stage` can
 * hand straight to `cf.versions.upload`.
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
 *     2. Return `{ kind: "single_file", bundle }`.
 *
 * - Manifest has BOTH `artifact_ref` and `bundle_manifest_ref` → directory
 *   wins. The manifest is in an inconsistent state (likely a mid-migration
 *   artifact); we prefer the newer field. The legacy ref is left unread.
 *
 * - Manifest has neither → `bundle_unavailable`.
 *
 * The factory is intentionally split from {@link make_corpus_bundle_provider}
 * during Phase 2.B so the legacy `BundleProvider` interface (`get(input)`) in
 * `@devpad/core/services/pipelines` keeps working unchanged. Phase 4
 * verification merges the two paths once Phase 2.A's CF provider lands.
 */
export const make_corpus_directory_bundle_provider = (backend: Backend): DirectoryBundleProvider => ({
	fetch: async (version_set_id: string): Promise<Result<BundleProviderResult, BundleProviderError>> => {
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
			return ok({ kind: "single_file", bundle: bytes.value });
		}

		return err({
			kind: "bundle_unavailable",
			reason: "manifest has neither builds.worker.artifact_ref nor builds.worker.bundle_manifest_ref",
		});
	},
});
