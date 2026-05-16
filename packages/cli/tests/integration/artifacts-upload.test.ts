import { describe, test, expect, beforeEach } from "bun:test";
import { create_memory_backend, version_set_store } from "@f0rbit/corpus";
import { build_manifest } from "../../src/pipelines-artifacts-helpers";
import type { ArtifactInputs } from "../../src/pipelines-artifacts-helpers";

describe("artifacts upload integration", () => {
	let backend: ReturnType<typeof create_memory_backend>;

	beforeEach(() => {
		backend = create_memory_backend();
	});

	test("uploads manifest to corpus and produces version-set ID", async () => {
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
			bundle: Buffer.from("worker bundle content"),
			bundle_ref: "worker-bundles/abc123",
			manifest: { routes: [], env: {} },
			manifest_ref: "env-manifests/def456",
			infra_plan: Buffer.from("infra plan content"),
			infra_plan_ref: "infra-plans/ghi789",
			pipeline: Buffer.from("pipeline definition"),
			pipeline_ref: "pipelines/jkl012",
			grants: Buffer.from("grants definition"),
			grants_ref: "grants/mno345",
		};

		// Build the manifest
		const manifest_result = build_manifest(inputs, artifacts);
		expect(manifest_result.ok).toBe(true);

		if (!manifest_result.ok) return;

		// Upload to corpus
		const version_sets = version_set_store(backend);
		const put_result = await version_sets.put(manifest_result.value);

		expect(put_result.ok).toBe(true);
		if (!put_result.ok) return;

		expect(put_result.value.version).toMatch(/^[a-zA-Z0-9_-]+$/);
		expect(put_result.value.content_hash).toMatch(/^[a-f0-9]{64}$/);

		// Verify we can retrieve the uploaded manifest
		const get_result = await version_sets.store.get(put_result.value.version);
		expect(get_result.ok).toBe(true);

		if (get_result.ok) {
			expect(get_result.value.data.package).toBe("test-package");
			expect(get_result.value.data.git_sha).toBe("1234567890abcdef1234567890abcdef12345678");
			expect(get_result.value.data.builds.worker.artifact_ref).toBe("worker-bundles/abc123");
		}
	});

	test("produces unique versions for different manifests", async () => {
		const version_sets = version_set_store(backend);

		const inputs1: ArtifactInputs = {
			package_name: "pkg-1",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts1 = {
			bundle: Buffer.from("bundle 1"),
			bundle_ref: "worker-bundles/abc",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/def",
			infra_plan: Buffer.from("infra"),
			infra_plan_ref: "infra-plans/ghi",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/jkl",
			grants: Buffer.from("grants"),
			grants_ref: "grants/mno",
		};

		const manifest_result1 = build_manifest(inputs1, artifacts1);
		expect(manifest_result1.ok).toBe(true);
		if (!manifest_result1.ok) return;

		const put1 = await version_sets.put(manifest_result1.value);
		expect(put1.ok).toBe(true);
		if (!put1.ok) return;

		const inputs2: ArtifactInputs = {
			package_name: "pkg-2",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts2 = {
			bundle: Buffer.from("bundle 2"),
			bundle_ref: "worker-bundles/xyz",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/uvw",
			infra_plan: Buffer.from("infra"),
			infra_plan_ref: "infra-plans/tsr",
			pipeline: Buffer.from("pipeline"),
			pipeline_ref: "pipelines/qpo",
			grants: Buffer.from("grants"),
			grants_ref: "grants/nml",
		};

		const manifest_result2 = build_manifest(inputs2, artifacts2);
		expect(manifest_result2.ok).toBe(true);
		if (!manifest_result2.ok) return;

		const put2 = await version_sets.put(manifest_result2.value);
		expect(put2.ok).toBe(true);
		if (!put2.ok) return;

		// Versions should be different
		expect(put1.value.version).not.toBe(put2.value.version);

		// Both should be retrievable
		const get1 = await version_sets.store.get(put1.value.version);
		const get2 = await version_sets.store.get(put2.value.version);

		expect(get1.ok).toBe(true);
		expect(get2.ok).toBe(true);

		if (get1.ok && get2.ok) {
			expect(get1.value.data.package).toBe("pkg-1");
			expect(get2.value.data.package).toBe("pkg-2");
		}
	});

	test("deduplicates identical manifests", async () => {
		const version_sets = version_set_store(backend);

		const inputs: ArtifactInputs = {
			package_name: "test-package",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
			git_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		};

		const artifacts = {
			bundle: Buffer.from("same bundle"),
			bundle_ref: "worker-bundles/abc",
			manifest: { routes: [] },
			manifest_ref: "env-manifests/def",
			infra_plan: Buffer.from("same infra"),
			infra_plan_ref: "infra-plans/ghi",
			pipeline: Buffer.from("same pipeline"),
			pipeline_ref: "pipelines/jkl",
			grants: Buffer.from("same grants"),
			grants_ref: "grants/mno",
		};

		const manifest_result1 = build_manifest(inputs, artifacts);
		expect(manifest_result1.ok).toBe(true);
		if (!manifest_result1.ok) return;

		const put1 = await version_sets.put(manifest_result1.value);
		expect(put1.ok).toBe(true);
		if (!put1.ok) return;

		const put2 = await version_sets.put(manifest_result1.value);
		expect(put2.ok).toBe(true);
		if (!put2.ok) return;

		// Content hashes should be identical
		expect(put1.value.content_hash).toBe(put2.value.content_hash);

		// Versions will be different (each put generates a new version)
		// but they reference the same content
		expect(put1.value.version).not.toBe(put2.value.version);
	});

	test("stores all artifact references in manifest", async () => {
		const version_sets = version_set_store(backend);

		const inputs: ArtifactInputs = {
			package_name: "comprehensive-test",
			bundle_path: "dist/_worker.js",
			manifest_path: "dist/manifest.json",
			infra_plan_path: "infra.ts",
			pipeline_path: "pipeline.ts",
			grants_path: "grants.ts",
		};

		const artifacts = {
			bundle: Buffer.from("worker bundle"),
			bundle_ref: "worker-bundles/bundle-hash-001",
			manifest: { version: 1 },
			manifest_ref: "env-manifests/manifest-hash-002",
			infra_plan: Buffer.from("d1 migration plan"),
			infra_plan_ref: "infra-plans/infra-hash-003",
			pipeline: Buffer.from("pipeline stages"),
			pipeline_ref: "pipelines/pipeline-hash-004",
			grants: Buffer.from("access grants"),
			grants_ref: "grants/grants-hash-005",
		};

		const manifest_result = build_manifest(inputs, artifacts);
		expect(manifest_result.ok).toBe(true);
		if (!manifest_result.ok) return;

		const put_result = await version_sets.put(manifest_result.value);
		expect(put_result.ok).toBe(true);
		if (!put_result.ok) return;

		// Retrieve and verify all references are stored
		const get_result = await version_sets.store.get(put_result.value.version);
		expect(get_result.ok).toBe(true);

		if (get_result.ok) {
			const manifest = get_result.value.data;
			expect(manifest.builds.worker.artifact_ref).toBe("worker-bundles/bundle-hash-001");
			expect(manifest.env_manifest_ref).toBe("env-manifests/manifest-hash-002");
			expect(manifest.infra_plan_ref).toBe("infra-plans/infra-hash-003");
			expect(manifest.grants_ref).toBe("grants/grants-hash-005");
		}
	});
});
