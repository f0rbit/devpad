/**
 * @module pipelines/artifacts
 *
 * Pure functions for building and validating artifact manifests.
 * All I/O (reading files, uploading to corpus) happens in the command handler.
 */

import { createHash } from "crypto";
import path from "node:path";
import { err, ok, type Result } from "@f0rbit/corpus";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { PipelineTemplateSchema, type PipelineTemplate } from "@devpad/pipeline-templates";

export interface ArtifactInputs {
	package_name: string;
	bundle_path: string;
	manifest_path: string;
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

	const paths = [
		{ name: "bundle_path", path: input.bundle_path },
		{ name: "manifest_path", path: input.manifest_path },
		{ name: "infra_plan_path", path: input.infra_plan_path },
		{ name: "pipeline_path", path: input.pipeline_path },
		{ name: "grants_path", path: input.grants_path },
	];

	for (const { name, path } of paths) {
		if (!path || path.trim() === "") {
			return err({
				kind: "validation_error",
				message: `${name} must not be empty`,
			});
		}
	}

	return ok(undefined);
}

export function build_manifest(
	inputs: ArtifactInputs,
	artifacts: {
		bundle: Buffer;
		bundle_ref: string;
		manifest: object;
		manifest_ref: string;
		infra_plan: Buffer;
		infra_plan_ref: string;
		pipeline: Buffer;
		pipeline_ref: string;
		grants: Buffer;
		grants_ref: string;
		template_ref?: string;
	},
): Result<VersionSetManifest, ArtifactUploadError> {
	try {
		const now = new Date().toISOString();
		const git_sha = inputs.git_sha || "0000000000000000000000000000000000000000";
		const compatibility_date = inputs.compatibility_date || "2025-05-01";

		// Ensure manifest is an object with the expected structure
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

		const version_set: VersionSetManifest = {
			package: inputs.package_name,
			git_sha,
			created_at: now,
			builds: {
				worker: {
					artifact_ref: artifacts.bundle_ref,
					size_bytes: artifacts.bundle.length,
					compatibility_date,
				},
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
			message: `template fails schema validation: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
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
			message: `JSON does not match PipelineTemplateSchema: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
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
	const cache_bust = `?t=${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
		if (result.ok === false) {
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
			message: `pipeline.ts default export is not a PipelineTemplate: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
		});
	}
	return ok(parsed.data);
};
