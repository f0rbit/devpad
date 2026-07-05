import { z } from "zod";

/**
 * Schemas for directory-bundle Worker uploads and static-asset (`ASSETS`
 * binding) uploads.
 *
 * These describe the shape of corpus-stored sub-manifests that the
 * directory-bundle flow uses:
 *
 *  - `BundleManifest` enumerates every module/chunk/wasm file inside a
 *    multi-file Worker bundle and points at the per-file corpus artifact
 *    storing its bytes.
 *  - `AssetManifest` enumerates every static asset file shipped via the
 *    Cloudflare `ASSETS` binding, carrying both the BLAKE3 hash CF expects
 *    on the upload-session manifest and the per-file corpus artifact ref.
 *
 * Phase 1 introduces the schemas only — Phase 2+ wires the CLI bundler and
 * CF API provider to produce and consume them. The single-file Worker flow
 * (`builds.worker.artifact_ref`) keeps working untouched.
 */

export const MODULE_MIME_TYPES = [
	"application/javascript+module",
	"application/javascript",
	"application/wasm",
	"application/octet-stream",
	"text/plain",
	"text/x-python",
	"text/x-python-requirement",
] as const;

/**
 * One module file inside a directory-bundle Worker.
 *
 * `name` is the path within the bundle (e.g. `"index.js"`,
 * `"chunks/Experience_C-JXuqRe.mjs"`, `"RESVG_WASM"`). It doubles as the
 * multipart form-field name on the CF `versions.upload` wire — for ES
 * module parts the CF runtime resolves relative imports inside the
 * entrypoint against these names; for `wasm_module` binding parts the
 * `metadata.bindings[].part` field references the same name.
 */
export const ModulePart = z.object({
	name: z.string(),
	mime_type: z.enum(MODULE_MIME_TYPES),
	content_artifact_ref: z.string(),
	size_bytes: z.number().int().nonnegative(),
});
export type ModulePart = z.infer<typeof ModulePart>;

/**
 * Full directory-bundle Worker manifest stored as its own corpus blob.
 *
 * `main_module` MUST match one of `modules[].name` — the CF API rejects
 * uploads where they disagree. Verification is left to consumers; the
 * schema only enforces shape so empty bundles (degenerate but legal) still
 * parse.
 */
export const BundleManifest = z.object({
	main_module: z.string(),
	modules: z.array(ModulePart),
	compatibility_date: z.string(),
	compatibility_flags: z.array(z.string()).default([]),
});
export type BundleManifest = z.infer<typeof BundleManifest>;

/**
 * One static-asset file in an `ASSETS`-binding upload.
 *
 * `hash` is BLAKE3 over `base64(file_bytes) + extension_without_dot`
 * truncated to the first 32 hex chars of the 64-char digest. This is the
 * exact algorithm wrangler 4.x uses on its assets-upload-session manifest
 * — the truncated form is the key CF's content-addressed asset store
 * expects on both the session manifest and the per-bucket multipart body.
 *
 * `content_artifact_ref` points at the corpus blob storing the file bytes
 * (keyed by sha256 for corpus dedup — separate from CF's BLAKE3 hash).
 */
export const AssetPart = z.object({
	path: z.string(),
	hash: z.string().length(32),
	size_bytes: z.number().int().nonnegative(),
	mime_type: z.string(),
	content_artifact_ref: z.string(),
});
export type AssetPart = z.infer<typeof AssetPart>;

const AssetsConfig = z.object({
	html_handling: z.enum(["auto-trailing-slash", "force-trailing-slash", "drop-trailing-slash", "none"]).optional(),
	not_found_handling: z.enum(["404-page", "single-page-application", "none"]).optional(),
	run_worker_first: z.boolean().optional(),
});

/**
 * Full `ASSETS`-binding asset manifest stored as its own corpus blob.
 *
 * `config` carries the optional CF-side serving config (HTML extension
 * handling, 404 / SPA fallback, run-worker-first toggle) — written
 * verbatim into `metadata.assets.config` on the `versions.upload` call.
 */
export const AssetManifest = z.object({
	assets: z.array(AssetPart),
	config: AssetsConfig.default({}),
});
export type AssetManifest = z.infer<typeof AssetManifest>;
