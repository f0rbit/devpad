/**
 * @module pipelines/artifacts
 *
 * Pure functions for building and validating artifact manifests.
 * All I/O (reading files, uploading to corpus) happens in the command handler.
 */

import path from "node:path";
import { AssetManifest, type AssetPart, BundleManifest, type ModulePart } from "@devpad/pipeline-fakes/manifests";
import { type PipelineTemplate, PipelineTemplateSchema } from "@devpad/pipeline-templates";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { err, ok, type Result } from "@f0rbit/corpus";
import { createHash } from "crypto";
import type { WalkedAssets } from "./asset-walker";
import type { WalkedBundle } from "./bundle-walker";

export interface ArtifactInputs {
	package_name: string;
	/** Path to the single-file Worker bundle. Mutually exclusive with `bundle_dir_path`. */
	bundle_path?: string;
	/** Path to the directory-bundle Worker (`dist/_worker.js/`). Mutually exclusive with `bundle_path`. */
	bundle_dir_path?: string;
	/** Path to env manifest JSON (`dist/manifest.json`). Optional — defaults to empty object when absent. */
	manifest_path?: string;
	infra_plan_path: string;
	pipeline_path: string;
	grants_path: string;
	git_sha?: string;
	compatibility_date?: string;
}

export interface ArtifactUploadError {
	kind: "file_error" | "validation_error" | "schema_error";
	message: string;
}

export function compute_hash(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

export function validate_artifact_paths(input: ArtifactInputs): Result<void, ArtifactUploadError> {
	if (!input.package_name || input.package_name.trim() === "") {
		return err({
			kind: "validation_error",
			message: "package_name must not be empty",
		});
	}

	const has_bundle = input.bundle_path !== undefined && input.bundle_path.trim() !== "";
	const has_bundle_dir = input.bundle_dir_path !== undefined && input.bundle_dir_path.trim() !== "";
	if (has_bundle && has_bundle_dir) {
		return err({ kind: "validation_error", message: "--bundle and --bundle-dir are mutually exclusive" });
	}
	if (!has_bundle && !has_bundle_dir) {
		return err({ kind: "validation_error", message: "either --bundle or --bundle-dir is required" });
	}

	const paths = [
		{ name: "infra_plan_path", path: input.infra_plan_path },
		{ name: "pipeline_path", path: input.pipeline_path },
		{ name: "grants_path", path: input.grants_path },
	];

	for (const { name, path: field_path } of paths) {
		if (!field_path || field_path.trim() === "") {
			return err({
				kind: "validation_error",
				message: `${name} must not be empty`,
			});
		}
	}

	return ok(undefined);
}

/**
 * Extended {@link VersionSetManifest} that surfaces the directory-bundle
 * + assets refs the upstream `@f0rbit/corpus` schema doesn't carry yet.
 *
 * TODO(corpus 0.7.0): once `VersionSetManifestSchema` learns
 * `builds.worker.bundle_manifest_ref?` and `builds.assets.manifest_ref?`
 * natively, drop this local extension and stamp the fields onto the
 * upstream type directly. Mirrors the Phase 2.B local extension in
 * `packages/pipelines/src/providers/corpus-providers.ts`.
 */
export type VersionSetManifestWithBundle = VersionSetManifest & {
	builds: VersionSetManifest["builds"] & {
		worker: VersionSetManifest["builds"]["worker"] & {
			bundle_manifest_ref?: string;
		};
		assets?: NonNullable<VersionSetManifest["builds"]["assets"]> & {
			manifest_ref?: string;
		};
	};
};

export interface BuildManifestArtifacts {
	/** Single-file bundle bytes. Set when `bundle_ref` is set. */
	bundle?: Buffer;
	/** Corpus ref for the single-file Worker bundle. Mutually exclusive with `bundle_manifest_ref`. */
	bundle_ref?: string;
	/** Corpus ref for the directory-bundle's `BundleManifest` blob. */
	bundle_manifest_ref?: string;
	/** Total bytes across all modules in the directory bundle. Required when `bundle_manifest_ref` is set. */
	bundle_total_size_bytes?: number;
	manifest: object;
	manifest_ref: string;
	infra_plan: Buffer;
	infra_plan_ref: string;
	pipeline: Buffer;
	pipeline_ref: string;
	grants: Buffer;
	grants_ref: string;
	template_ref?: string;
	/** Corpus ref for the {@link AssetManifest} blob — emitted when `--assets-dir` was supplied. */
	asset_manifest_ref?: string;
}

export function build_manifest(
	inputs: ArtifactInputs,
	artifacts: BuildManifestArtifacts,
): Result<VersionSetManifestWithBundle, ArtifactUploadError> {
	try {
		const now = new Date().toISOString();
		const git_sha = inputs.git_sha || "0000000000000000000000000000000000000000";
		const compatibility_date = inputs.compatibility_date || "2025-05-01";

		let manifest_data = artifacts.manifest;
		if (typeof manifest_data === "string") {
			try {
				manifest_data = JSON.parse(manifest_data);
			} catch {
				return err({
					kind: "schema_error",
					message: "manifest.json is not valid JSON",
				});
			}
		}

		const has_single_file = artifacts.bundle_ref !== undefined;
		const has_directory = artifacts.bundle_manifest_ref !== undefined;
		if (has_single_file === has_directory) {
			return err({
				kind: "schema_error",
				message: "exactly one of bundle_ref or bundle_manifest_ref must be set",
			});
		}

		const worker_base =
			artifacts.bundle_ref !== undefined
				? {
						artifact_ref: artifacts.bundle_ref,
						size_bytes: artifacts.bundle?.length ?? 0,
						compatibility_date,
					}
				: {
						// Phase 2.B keeps `artifact_ref` required at the corpus type
						// level — the orchestrator's local extended schema treats it
						// as optional. For the directory path we stamp an empty
						// `artifact_ref` so old strict consumers don't reject the
						// manifest, while the new `bundle_manifest_ref` is the
						// authoritative reference.
						artifact_ref: "",
						// `has_single_file === has_directory` was rejected above, so
						// `bundle_manifest_ref` is always set here — the `?? ""`
						// fallback is type-safety only, never reached at runtime.
						bundle_manifest_ref: artifacts.bundle_manifest_ref ?? "",
						size_bytes: artifacts.bundle_total_size_bytes ?? 0,
						compatibility_date,
					};

		const assets_block =
			artifacts.asset_manifest_ref !== undefined
				? {
						manifest_ref: artifacts.asset_manifest_ref,
						version_affinity: "pinned" as const,
					}
				: undefined;

		const version_set: VersionSetManifestWithBundle = {
			package: inputs.package_name,
			git_sha,
			created_at: now,
			builds: {
				worker: worker_base,
				...(assets_block !== undefined ? { assets: assets_block } : {}),
			},
			migrations: {
				d1_plan_ref: artifacts.infra_plan_ref,
				do_migrations: [],
			},
			env_manifest_ref: artifacts.manifest_ref,
			infra_plan_ref: artifacts.infra_plan_ref,
			grants_ref: artifacts.grants_ref,
			...(artifacts.template_ref !== undefined ? { template_ref: artifacts.template_ref } : {}),
		};

		return ok(version_set);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return err({
			kind: "schema_error",
			message: `Failed to build manifest: ${message}`,
		});
	}
}

/**
 * Build a {@link BundleManifest} from a walked directory-bundle plus per-module
 * corpus refs assigned by `POST /artifacts/blob`. Pure.
 *
 * The caller is responsible for ensuring `module_refs` has exactly one entry
 * per `walked.parts[i].name` — order matches the walker's deterministic sort.
 * `main_module` must match one of the part names; we don't enforce it here
 * (corpus accepts the manifest verbatim) but the CF API rejects mismatches at
 * deploy time.
 */
export function build_bundle_manifest_from_walk(
	walked: WalkedBundle,
	module_refs: string[],
	main_module: string,
	compatibility_date: string,
	compatibility_flags: string[],
): Result<BundleManifest, ArtifactUploadError> {
	if (module_refs.length !== walked.parts.length) {
		return err({
			kind: "schema_error",
			message: `module_refs length (${String(module_refs.length)}) doesn't match walked parts (${String(walked.parts.length)})`,
		});
	}
	const modules: ModulePart[] = walked.parts.map((part, idx) => ({
		name: part.name,
		mime_type: part.mime_type,
		content_artifact_ref: module_refs[idx],
		size_bytes: part.size_bytes,
	}));
	const candidate: unknown = {
		main_module,
		modules,
		compatibility_date,
		compatibility_flags,
	};
	const parsed = BundleManifest.safeParse(candidate);
	if (!parsed.success) {
		return err({ kind: "schema_error", message: `BundleManifest validation failed: ${parsed.error.message}` });
	}
	return ok(parsed.data);
}

/**
 * Build an {@link AssetManifest} from a walked asset directory plus per-file
 * corpus refs. Pure. Same length-pairing contract as
 * {@link build_bundle_manifest_from_walk}.
 */
export function build_asset_manifest_from_walk(
	walked: WalkedAssets,
	asset_refs: string[],
	config: object = {},
): Result<AssetManifest, ArtifactUploadError> {
	if (asset_refs.length !== walked.parts.length) {
		return err({
			kind: "schema_error",
			message: `asset_refs length (${String(asset_refs.length)}) doesn't match walked parts (${String(walked.parts.length)})`,
		});
	}
	const assets: AssetPart[] = walked.parts.map((part, idx) => ({
		path: part.path,
		hash: part.hash,
		size_bytes: part.size_bytes,
		mime_type: part.mime_type,
		content_artifact_ref: asset_refs[idx],
	}));
	const candidate: unknown = { assets, config };
	const parsed = AssetManifest.safeParse(candidate);
	if (!parsed.success) {
		return err({ kind: "schema_error", message: `AssetManifest validation failed: ${parsed.error.message}` });
	}
	return ok(parsed.data);
}

export interface VersionSetOutput {
	id: string;
	version: string;
	package: string;
}

// ─── Pipeline template compilation ──────────────────────────────────────
//
// `pipeline.ts` is a pure declaration. The CI compile step
// dynamic-imports it via Bun's native TS loader, extracts the default
// export (a `Result<PipelineTemplate, DslError>` produced by
// `extendTemplate`), and serialises it to JSON for upload to the
// `pipeline-templates` corpus store.
//
// Two layers:
// - `compile_template_to_json` + `parse_template_from_json`: pure JSON
//   round-trip + Zod validation. Unit testable without filesystem.
// - `compile_pipeline_ts`: side-effectful dynamic-import that produces
//   the typed template. Used by the CLI upload command.

export type CompileError =
	| { kind: "build_failed"; message: string }
	| { kind: "import_failed"; message: string }
	| { kind: "not_a_template"; message: string }
	| { kind: "dsl_error"; cause: unknown };

/**
 * Serialise a {@link PipelineTemplate} to a deterministic JSON string.
 *
 * Pure. The validation step guards against function values, undefined
 * fields, and other shapes that `JSON.stringify` silently drops — if
 * any field is missing from the schema's view, we surface a
 * `not_a_template` error here rather than uploading garbage.
 */
export function compile_template_to_json(template: PipelineTemplate): Result<string, CompileError> {
	const parsed = PipelineTemplateSchema.safeParse(template);
	if (!parsed.success) {
		return err({
			kind: "not_a_template",
			message: `template fails schema validation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
		});
	}
	const json = JSON.stringify(parsed.data);
	return ok(json);
}

/**
 * Parse a serialised template JSON blob back into a typed
 * {@link PipelineTemplate}. Inverse of {@link compile_template_to_json}.
 *
 * Pure. Used by the orchestrator's resolver to rehydrate a stored
 * template snapshot.
 */
export function parse_template_from_json(json: string): Result<PipelineTemplate, CompileError> {
	let decoded: unknown;
	try {
		decoded = JSON.parse(json);
	} catch (e) {
		return err({ kind: "not_a_template", message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
	}
	const parsed = PipelineTemplateSchema.safeParse(decoded);
	if (!parsed.success) {
		return err({
			kind: "not_a_template",
			message: `JSON does not match PipelineTemplateSchema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
		});
	}
	return ok(parsed.data);
}

/**
 * Dynamic-import a `pipeline.ts` file via Bun's native TS loader and
 * extract the {@link PipelineTemplate} from its default export.
 *
 * `pipeline.ts` files declare their pipeline via `extendTemplate(...)`
 * which returns a `Result<PipelineTemplate, DslError>`. We accept either
 * a `Result` shape (the conventional declaration) or a plain
 * {@link PipelineTemplate} (older / hand-rolled cases) — both are
 * normalised here.
 *
 * Side effect: dynamic-import (executes module top-level code). The
 * scaffolder enforces that `pipeline.ts` is a pure declaration — no
 * `process.env`, no top-level `await`, no non-template imports — so this
 * is safe at CI compile time. A cache-bust query string is appended to
 * the import URL so repeated compiles within the same process don't
 * re-use a stale default export (Bun caches by URL).
 */
export async function compile_pipeline_ts(pipeline_path: string): Promise<Result<PipelineTemplate, CompileError>> {
	const absolute_path = path.resolve(pipeline_path);
	const cache_bust = `?t=${String(Date.now())}-${String(Math.floor(Math.random() * 1_000_000))}`;
	const import_url = `${absolute_path}${cache_bust}`;

	let module_ns: { default?: unknown };
	try {
		module_ns = (await import(import_url)) as { default?: unknown };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		// Bun raises a parse / resolution failure as a generic Error. Map
		// to `build_failed` so callers can distinguish a syntactically
		// broken pipeline.ts from a structurally invalid one.
		if (/SyntaxError|parse|expected|Bundle|errors building/i.test(message)) {
			return err({ kind: "build_failed", message });
		}
		return err({ kind: "import_failed", message });
	}

	return normalise_module_default(module_ns.default);
}

const normalise_module_default = (default_export: unknown): Result<PipelineTemplate, CompileError> => {
	if (default_export === undefined || default_export === null) {
		return err({ kind: "not_a_template", message: "pipeline.ts has no default export" });
	}

	// Case 1: `extendTemplate(...)` returns a `Result<PipelineTemplate, DslError>`.
	if (typeof default_export === "object" && "ok" in (default_export as Record<string, unknown>)) {
		const result = default_export as { ok: boolean; value?: unknown; error?: unknown };
		if (!result.ok) {
			return err({ kind: "dsl_error", cause: result.error });
		}
		return validate_template_shape(result.value);
	}

	// Case 2: a plain `PipelineTemplate` object.
	return validate_template_shape(default_export);
};

const validate_template_shape = (candidate: unknown): Result<PipelineTemplate, CompileError> => {
	const parsed = PipelineTemplateSchema.safeParse(candidate);
	if (!parsed.success) {
		return err({
			kind: "not_a_template",
			message: `pipeline.ts default export is not a PipelineTemplate: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
		});
	}
	return ok(parsed.data);
};
