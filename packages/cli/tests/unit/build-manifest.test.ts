import { describe, test, expect } from "bun:test";
import { build_manifest, compute_hash, validate_artifact_paths } from "../../src/pipelines-artifacts-helpers";
import type { ArtifactInputs } from "../../src/pipelines-artifacts-helpers";

describe("compute_hash", () => {
	test("computes sha256 hash of buffer content", () => {
		const buffer = Buffer.from("test content");
		const hash = compute_hash(buffer);
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	test("produces consistent hash for same content", () => {
		const buffer = Buffer.from("test content");
		const hash1 = compute_hash(buffer);
		const hash2 = compute_hash(buffer);
		expect(hash1).toBe(hash2);
	});

	test("produces different hash for different content", () => {
		const hash1 = compute_hash(Buffer.from("content1"));
		const hash2 = compute_hash(Buffer.from("content2"));
		expect(hash1).not.toBe(hash2);
	});
});

describe("validate_artifact_paths", () => {
	test("accepts valid inputs", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const result = validate_artifact_paths(inputs);
		expect(result.ok).toBe(true);
	});

	test("rejects empty package name", () => {
		const inputs: ArtifactInputs = {
			package_name: "",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const result = validate_artifact_paths(inputs);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("validation_error");
			expect(result.error.message).toContain("package_name");
		}
	});

	test("rejects missing bundle path", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const result = validate_artifact_paths(inputs);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("validation_error");
		}
	});
});

describe("build_manifest", () => {
	test("builds valid manifest with all fields", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
			git_sha: "1234567890abcdef1234567890abcdef12345678",
			compatibility_date: "2025-05-17",
		};

		const artifacts = {
			bundle: Buffer.from("bundle content"),
			bundle_ref: "worker-bundles/abc123",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno345",
		};

		const result = build_manifest(inputs, artifacts);
		expect(result.ok).toBe(true);

		if (result.ok) {
			const manifest = result.value;
			expect(manifest.package).toBe("test-package");
			expect(manifest.git_sha).toBe("1234567890abcdef1234567890abcdef12345678");
			expect(manifest.builds.worker.compatibility_date).toBe("2025-05-17");
			expect(manifest.builds.worker.artifact_ref).toBe("worker-bundles/abc123");
			expect(manifest.env_manifest_ref).toBe("env-manifests/def456");
			expect(manifest.infra_plan_ref).toBe("infra-plans/ghi789");
			expect(manifest.grants_ref).toBe("grants/mno345");
			expect(manifest.migrations.do_migrations).toEqual([]);
		}
	});

	test("uses default git_sha and compatibility_date when not provided", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts = {
			bundle: Buffer.from("bundle content"),
			bundle_ref: "worker-bundles/abc123",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno345",
		};

		const result = build_manifest(inputs, artifacts);
		expect(result.ok).toBe(true);

		if (result.ok) {
			const manifest = result.value;
			expect(manifest.git_sha).toBe("0000000000000000000000000000000000000000");
			expect(manifest.builds.worker.compatibility_date).toBe("2025-05-01");
		}
	});

	test("handles string manifest and parses it to object", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts = {
			bundle: Buffer.from("bundle content"),
			bundle_ref: "worker-bundles/abc123",
			manifest: '{"routes":[]}',
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno345",
		};

		const result = build_manifest(inputs, artifacts as any);
		expect(result.ok).toBe(true);
	});

	test("rejects invalid manifest JSON", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts = {
			bundle: Buffer.from("bundle content"),
			bundle_ref: "worker-bundles/abc123",
			manifest: "{ invalid json",
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno345",
		};

		const result = build_manifest(inputs, artifacts as any);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("schema_error");
		}
	});

	test("includes bundle size in manifest", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const bundle_content = Buffer.from("x".repeat(5000));
		const artifacts = {
			bundle: bundle_content,
			bundle_ref: "worker-bundles/abc123",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno345",
		};

		const result = build_manifest(inputs, artifacts);
		expect(result.ok).toBe(true);

		if (result.ok) {
			expect(result.value.builds.worker.size_bytes).toBe(5000);
		}
	});

	test("sets created_at to ISO timestamp", () => {
		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts = {
			bundle: Buffer.from("bundle content"),
			bundle_ref: "worker-bundles/abc123",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno345",
		};

		const result = build_manifest(inputs, artifacts);
		expect(result.ok).toBe(true);

		if (result.ok) {
			const manifest = result.value;
			expect(manifest.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		}
	});
});
