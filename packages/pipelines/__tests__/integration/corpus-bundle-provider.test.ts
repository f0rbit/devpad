/**
 * Coverage for `make_corpus_directory_bundle_provider` (Phase 2.B).
 *
 * Exercises all five routing branches the provider implements:
 *
 *  1. Legacy single-file manifest (`builds.worker.artifact_ref` only) →
 *     `{ kind: "single_file", bytes }`.
 *  2. Directory-bundle manifest without assets
 *     (`builds.worker.bundle_manifest_ref`) →
 *     `{ kind: "directory_bundle", modules, ... }`.
 *  3. Directory-bundle manifest with assets (both `bundle_manifest_ref` and
 *     `builds.assets.manifest_ref`) → `{ ..., assets: { assets, config } }`.
 *  4. Missing or malformed sub-manifests → typed `BundleProviderError`s.
 *  5. Inconsistent manifest carrying BOTH `artifact_ref` and
 *     `bundle_manifest_ref` → directory path wins, legacy ref ignored.
 *
 * All tests use the in-memory corpus backend with directly-seeded blobs so
 * the bundle/asset manifests sit at deterministic refs.
 */

import { describe, expect, test } from "bun:test";
import type { AssetManifest, BundleManifest } from "@devpad/pipeline-fakes";
import { type Backend, create_memory_backend, type VersionSetManifest, version_set_store } from "@f0rbit/corpus";
import {
	type BundleProviderError,
	make_corpus_directory_bundle_provider,
} from "../../src/providers/corpus-providers.ts";

// VersionSetManifest is "strict" in the corpus types; the directory provider
// reads the extra Phase 2.B fields from the JSON-serialised manifest. We cast
// through `unknown` at the seed boundary so the test compiles without faking
// out the corpus typings repo-wide.
type ManifestWithExtras = VersionSetManifest & {
	builds: VersionSetManifest["builds"] & {
		worker: VersionSetManifest["builds"]["worker"] & { bundle_manifest_ref?: string };
		assets?: NonNullable<VersionSetManifest["builds"]["assets"]> & { manifest_ref?: string };
	};
};

const single_file_manifest = (): ManifestWithExtras => ({
	package: "test-pkg",
	git_sha: "0123456789abcdef0123456789abcdef01234567",
	created_at: "2026-05-17T00:00:00.000Z",
	builds: {
		worker: {
			artifact_ref: "worker-bundles/legacy-abc",
			size_bytes: 18,
			compatibility_date: "2025-05-01",
		},
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "env-manifests/v1",
	infra_plan_ref: "infra-plans/v1",
});

const directory_manifest = (overrides?: {
	with_assets?: boolean;
	with_legacy_artifact?: boolean;
}): ManifestWithExtras => ({
	package: "test-pkg",
	git_sha: "feedfacefeedfacefeedfacefeedfacefeedface",
	created_at: "2026-05-17T00:00:00.000Z",
	builds: {
		worker: {
			artifact_ref: overrides?.with_legacy_artifact === true ? "worker-bundles/should-be-ignored" : "",
			size_bytes: 256,
			compatibility_date: "2025-05-01",
			bundle_manifest_ref: "bundle-manifests/dir-bundle-001",
		},
		assets:
			overrides?.with_assets === true
				? { version_affinity: "pinned", manifest_ref: "asset-manifests/assets-001" }
				: undefined,
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "env-manifests/v1",
	infra_plan_ref: "infra-plans/v1",
});

const seed_blob = async (backend: Backend, key: string, bytes: Uint8Array) => {
	const put = await backend.data.put(key, bytes);
	if (!put.ok) throw new Error(`seed blob ${key} failed: ${put.error.kind}`);
};

const seed_json_blob = async (backend: Backend, key: string, json: unknown) => {
	const bytes = new TextEncoder().encode(JSON.stringify(json));
	await seed_blob(backend, key, bytes);
};

const sample_bundle_manifest = (): BundleManifest => ({
	main_module: "index.js",
	modules: [
		{
			name: "index.js",
			mime_type: "application/javascript+module",
			content_artifact_ref: "worker-bundles/index-js-001",
			size_bytes: 21,
		},
		{
			name: "chunks/lib.mjs",
			mime_type: "application/javascript+module",
			content_artifact_ref: "worker-bundles/lib-mjs-001",
			size_bytes: 11,
		},
		{
			name: "RESVG_WASM",
			mime_type: "application/wasm",
			content_artifact_ref: "worker-bundles/resvg-wasm-001",
			size_bytes: 4,
		},
	],
	compatibility_date: "2025-05-01",
	compatibility_flags: ["nodejs_compat"],
});

const sample_asset_manifest = (): AssetManifest => ({
	assets: [
		{
			path: "/index.html",
			hash: "a".repeat(32),
			size_bytes: 13,
			mime_type: "text/html",
			content_artifact_ref: "asset-bundles/index-html-001",
		},
		{
			path: "/style.css",
			hash: "b".repeat(32),
			size_bytes: 18,
			mime_type: "text/css",
			content_artifact_ref: "asset-bundles/style-css-001",
		},
	],
	config: { html_handling: "auto-trailing-slash", run_worker_first: false },
});

const seed_bundle = async (
	backend: Backend,
	manifest: BundleManifest,
	refs: { ref: string; contents: Record<string, Uint8Array> },
) => {
	await seed_json_blob(backend, refs.ref, manifest);
	for (const m of manifest.modules) {
		const bytes = refs.contents[m.name];
		if (bytes === undefined) throw new Error(`test fixture missing bytes for module ${m.name}`);
		await seed_blob(backend, m.content_artifact_ref, bytes);
	}
};

const seed_assets = async (
	backend: Backend,
	manifest: AssetManifest,
	refs: { ref: string; contents: Record<string, Uint8Array> },
) => {
	await seed_json_blob(backend, refs.ref, manifest);
	for (const a of manifest.assets) {
		const bytes = refs.contents[a.path];
		if (bytes === undefined) throw new Error(`test fixture missing bytes for asset ${a.path}`);
		await seed_blob(backend, a.content_artifact_ref, bytes);
	}
};

const put_manifest = async (backend: Backend, manifest: ManifestWithExtras): Promise<string> => {
	// Cast to VersionSetManifest at the seed boundary: corpus's `json_codec`
	// encodes via `JSON.stringify(value)` without schema validation, so the
	// extra Phase 2.B fields survive into the stored bytes. The directory
	// provider reads them back via its locally-extended schema.
	const put = await version_set_store(backend).put(manifest as unknown as VersionSetManifest);
	if (!put.ok) throw new Error(`manifest put failed: ${put.error.kind}`);
	return put.value.version;
};

describe("make_corpus_directory_bundle_provider", () => {
	test("single-file manifest returns { kind: 'single_file', bytes }", async () => {
		const backend = create_memory_backend();
		const bundle_bytes = new TextEncoder().encode("export default {};");
		await seed_blob(backend, "worker-bundles/legacy-abc", bundle_bytes);
		const manifest = single_file_manifest();
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.kind).toBe("single_file");
		if (result.value.kind !== "single_file") return;
		expect(new TextDecoder().decode(result.value.bytes)).toBe("export default {};");
	});

	test("directory-bundle manifest without assets returns hydrated modules", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		await seed_bundle(backend, bundle, {
			ref: "bundle-manifests/dir-bundle-001",
			contents: {
				"index.js": new TextEncoder().encode("export default { fetch: () => {} };"),
				"chunks/lib.mjs": new TextEncoder().encode("export const x = 1;"),
				RESVG_WASM: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			},
		});
		const manifest = directory_manifest();
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.kind).toBe("directory_bundle");
		if (result.value.kind !== "directory_bundle") return;
		expect(result.value.main_module).toBe("index.js");
		expect(result.value.compatibility_date).toBe("2025-05-01");
		expect(result.value.compatibility_flags).toEqual(["nodejs_compat"]);
		expect(result.value.modules).toHaveLength(3);
		expect(result.value.modules[0]).toEqual({
			name: "index.js",
			mime_type: "application/javascript+module",
			content: new TextEncoder().encode("export default { fetch: () => {} };"),
		});
		expect(result.value.modules[2].name).toBe("RESVG_WASM");
		expect(result.value.modules[2].mime_type).toBe("application/wasm");
		expect(result.value.assets).toBeUndefined();
	});

	test("directory-bundle manifest with assets hydrates both modules and assets", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		await seed_bundle(backend, bundle, {
			ref: "bundle-manifests/dir-bundle-001",
			contents: {
				"index.js": new TextEncoder().encode("export default { fetch: () => {} };"),
				"chunks/lib.mjs": new TextEncoder().encode("export const x = 1;"),
				RESVG_WASM: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			},
		});
		const assets = sample_asset_manifest();
		await seed_assets(backend, assets, {
			ref: "asset-manifests/assets-001",
			contents: {
				"/index.html": new TextEncoder().encode("<!doctype html>"),
				"/style.css": new TextEncoder().encode("body { margin: 0; }"),
			},
		});
		const manifest = directory_manifest({ with_assets: true });
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		if (result.value.kind !== "directory_bundle") {
			throw new Error(`expected directory_bundle, got ${result.value.kind}`);
		}
		expect(result.value.assets).toBeDefined();
		if (result.value.assets === undefined) return;
		expect(result.value.assets.assets).toHaveLength(2);
		expect(result.value.assets.assets[0]).toEqual({
			path: "/index.html",
			hash: "a".repeat(32),
			size_bytes: 13,
			mime_type: "text/html",
			content: new TextEncoder().encode("<!doctype html>"),
		});
		expect(result.value.assets.config?.html_handling).toBe("auto-trailing-slash");
		expect(result.value.assets.config?.run_worker_first).toBe(false);
	});

	test("missing bundle manifest blob → bundle_manifest_missing", async () => {
		const backend = create_memory_backend();
		const manifest = directory_manifest();
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("bundle_manifest_missing");
		if (error.kind !== "bundle_manifest_missing") return;
		expect(error.ref).toBe("bundle-manifests/dir-bundle-001");
	});

	test("invalid bundle manifest JSON → bundle_manifest_invalid", async () => {
		const backend = create_memory_backend();
		await seed_blob(backend, "bundle-manifests/dir-bundle-001", new TextEncoder().encode("{ not valid json"));
		const manifest = directory_manifest();
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("bundle_manifest_invalid");
	});

	test("missing per-module artifact → module_fetch_failed", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		// Seed the bundle manifest, but only seed bytes for one of the modules
		// — the second module's `content_artifact_ref` is absent.
		await seed_json_blob(backend, "bundle-manifests/dir-bundle-001", bundle);
		await seed_blob(backend, "worker-bundles/index-js-001", new TextEncoder().encode("export default {};"));
		const manifest = directory_manifest();
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("module_fetch_failed");
		if (error.kind !== "module_fetch_failed") return;
		expect(error.ref).toBe("worker-bundles/lib-mjs-001");
	});

	test("missing asset manifest blob → asset_manifest_missing", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		await seed_bundle(backend, bundle, {
			ref: "bundle-manifests/dir-bundle-001",
			contents: {
				"index.js": new TextEncoder().encode("export default {};"),
				"chunks/lib.mjs": new TextEncoder().encode("export const x = 1;"),
				RESVG_WASM: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			},
		});
		// Don't seed the asset manifest blob.
		const manifest = directory_manifest({ with_assets: true });
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("asset_manifest_missing");
		if (error.kind !== "asset_manifest_missing") return;
		expect(error.ref).toBe("asset-manifests/assets-001");
	});

	test("invalid asset manifest JSON → asset_manifest_invalid", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		await seed_bundle(backend, bundle, {
			ref: "bundle-manifests/dir-bundle-001",
			contents: {
				"index.js": new TextEncoder().encode("export default {};"),
				"chunks/lib.mjs": new TextEncoder().encode("export const x = 1;"),
				RESVG_WASM: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			},
		});
		await seed_blob(backend, "asset-manifests/assets-001", new TextEncoder().encode("{ also not valid"));
		const manifest = directory_manifest({ with_assets: true });
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("asset_manifest_invalid");
	});

	test("missing per-asset artifact → asset_fetch_failed", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		await seed_bundle(backend, bundle, {
			ref: "bundle-manifests/dir-bundle-001",
			contents: {
				"index.js": new TextEncoder().encode("export default {};"),
				"chunks/lib.mjs": new TextEncoder().encode("export const x = 1;"),
				RESVG_WASM: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			},
		});
		const assets = sample_asset_manifest();
		// Seed only the manifest blob, not the per-asset bytes.
		await seed_json_blob(backend, "asset-manifests/assets-001", assets);
		const manifest = directory_manifest({ with_assets: true });
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("asset_fetch_failed");
		if (error.kind !== "asset_fetch_failed") return;
		expect(error.ref).toBe("asset-bundles/index-html-001");
	});

	test("manifest with BOTH artifact_ref and bundle_manifest_ref prefers directory path", async () => {
		const backend = create_memory_backend();
		const bundle = sample_bundle_manifest();
		await seed_bundle(backend, bundle, {
			ref: "bundle-manifests/dir-bundle-001",
			contents: {
				"index.js": new TextEncoder().encode("export default {};"),
				"chunks/lib.mjs": new TextEncoder().encode("export const x = 1;"),
				RESVG_WASM: new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
			},
		});
		// Seed the legacy artifact too — it should be ignored.
		await seed_blob(backend, "worker-bundles/should-be-ignored", new TextEncoder().encode("LEGACY"));
		const manifest = directory_manifest({ with_legacy_artifact: true });
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.kind).toBe("directory_bundle");
		if (result.value.kind !== "directory_bundle") return;
		expect(result.value.modules).toHaveLength(3);
	});

	test("manifest with neither artifact_ref nor bundle_manifest_ref → bundle_unavailable", async () => {
		const backend = create_memory_backend();
		const manifest: ManifestWithExtras = {
			...single_file_manifest(),
			builds: {
				worker: { artifact_ref: "", size_bytes: 0, compatibility_date: "2025-05-01" },
			},
		};
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("bundle_unavailable");
	});

	test("missing legacy artifact blob → bundle_unavailable", async () => {
		const backend = create_memory_backend();
		const manifest = single_file_manifest();
		// Don't seed the bundle bytes — only the manifest.
		const version = await put_manifest(backend, manifest);

		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch(version);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("bundle_unavailable");
	});

	test("unknown version_set_id → version_set_missing", async () => {
		const backend = create_memory_backend();
		const provider = make_corpus_directory_bundle_provider(backend);
		const result = await provider.fetch("does-not-exist");

		expect(result.ok).toBe(false);
		if (result.ok) return;
		const error = result.error as BundleProviderError;
		expect(error.kind).toBe("version_set_missing");
		if (error.kind !== "version_set_missing") return;
		expect(error.version_set_id).toBe("does-not-exist");
	});
});
