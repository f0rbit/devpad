/**
 * @module pipelines/artifacts
 *
 * Pure functions for building and validating artifact manifests.
 * All I/O (reading files, uploading to corpus) happens in the command handler.
 */

import { createHash } from "crypto";
import { err, ok, type Result } from "@f0rbit/corpus";
import type { VersionSetManifest } from "@f0rbit/corpus";

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
