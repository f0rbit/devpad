/**
 * Orchestrator-side coverage for `make_corpus_template_resolver`.
 *
 * Round-trip via the corpus stores: upload a compiled template JSON to
 * `pipeline-templates`, upload a `VersionSetManifest` with the matching
 * `template_ref`, call the resolver, assert the typed template comes
 * back. Negative path: a manifest without `template_ref` falls back to
 * the built-in default gradual template.
 */

import { describe, test, expect } from "bun:test";
import { create_memory_backend, pipeline_template_store, version_set_store, type VersionSetManifest } from "@f0rbit/corpus";
import { extendTemplate, PipelineTemplateSchema, type PipelineTemplate } from "@devpad/pipeline-templates";
import { make_corpus_manifest_provider, make_corpus_template_resolver } from "../../src/providers/corpus-providers";

const atomic_template: PipelineTemplate = {
	rollout: { type: "atomic" },
	gates: { "staging→atomic-prod": { type: "auto" } },
	pre_deploy_checks: [],
	post_deploy_checks: [],
};

const make_manifest = (overrides?: Partial<VersionSetManifest>): VersionSetManifest => ({
	package: "anthropic-search",
	git_sha: "0123456789abcdef0123456789abcdef01234567",
	created_at: "2026-05-17T00:00:00.000Z",
	builds: {
		worker: {
			artifact_ref: "worker-bundles/abc123",
			size_bytes: 12345,
			compatibility_date: "2025-05-01",
		},
	},
	migrations: {
		do_migrations: [],
	},
	env_manifest_ref: "env-manifests/abc",
	infra_plan_ref: "infra-plans/abc",
	...overrides,
});

describe("make_corpus_template_resolver", () => {
	test("loads an atomic template uploaded as a corpus blob", async () => {
		const backend = create_memory_backend();
		const templates = pipeline_template_store(backend, PipelineTemplateSchema);
		const version_sets = version_set_store(backend);

		const template_put = await templates.put(atomic_template);
		expect(template_put.ok).toBe(true);
		if (!template_put.ok) return;

		const manifest_put = await version_sets.put(
			make_manifest({
				template_ref: `pipeline-templates/${template_put.value.content_hash}`,
			}),
		);
		expect(manifest_put.ok).toBe(true);
		if (!manifest_put.ok) return;

		const manifests = make_corpus_manifest_provider(backend);
		const resolver = make_corpus_template_resolver(backend, manifests);

		const result = await resolver.resolve("anthropic-search", manifest_put.value.version);
		expect(result).not.toBeNull();
		if (result === null) return;
		expect(result.rollout.type).toBe("atomic");
		expect(result.gates["staging→atomic-prod"]).toEqual({ type: "auto" });
	});

	test("falls back to default gradual when manifest has no template_ref", async () => {
		const backend = create_memory_backend();
		const version_sets = version_set_store(backend);

		const manifest_put = await version_sets.put(make_manifest());
		expect(manifest_put.ok).toBe(true);
		if (!manifest_put.ok) return;

		const manifests = make_corpus_manifest_provider(backend);
		const resolver = make_corpus_template_resolver(backend, manifests);

		const result = await resolver.resolve("anthropic-search", manifest_put.value.version);
		expect(result).not.toBeNull();
		if (result === null) return;

		// Same shape as `extendTemplate({})`, locked here so a future
		// drift in the default surface trips this assertion.
		const expected = extendTemplate({});
		expect(expected.ok).toBe(true);
		if (!expected.ok) return;
		expect(result).toEqual(expected.value);
		expect(result.rollout.type).toBe("gradual");
	});

	test("returns null when manifest is missing entirely", async () => {
		const backend = create_memory_backend();
		const manifests = make_corpus_manifest_provider(backend);
		const resolver = make_corpus_template_resolver(backend, manifests);

		const result = await resolver.resolve("pkg-anything", "does-not-exist");
		expect(result).toBeNull();
	});

	test("returns null when template_ref points at a missing blob", async () => {
		const backend = create_memory_backend();
		const version_sets = version_set_store(backend);

		const manifest_put = await version_sets.put(
			make_manifest({
				template_ref: "pipeline-templates/deadbeef0000000000000000",
			}),
		);
		expect(manifest_put.ok).toBe(true);
		if (!manifest_put.ok) return;

		const manifests = make_corpus_manifest_provider(backend);
		const resolver = make_corpus_template_resolver(backend, manifests);

		const result = await resolver.resolve("anthropic-search", manifest_put.value.version);
		expect(result).toBeNull();
	});

	test("loads a gradual template with stages + manual gates from a corpus blob", async () => {
		const gradual_template: PipelineTemplate = {
			rollout: {
				type: "gradual",
				stages: [
					{ name: "onebox", traffic: 1, bake: { ms: 60_000 } },
					{ name: "wave1", traffic: 50, bake: { ms: 300_000 } },
					{ name: "full", traffic: 100, bake: { ms: 0 } },
				],
			},
			gates: {
				"staging→onebox": { type: "manual" },
				"onebox→wave1": { type: "manual" },
				"wave1→full": { type: "auto" },
			},
			pre_deploy_checks: [],
			post_deploy_checks: [],
		};

		const backend = create_memory_backend();
		const templates = pipeline_template_store(backend, PipelineTemplateSchema);
		const version_sets = version_set_store(backend);

		const template_put = await templates.put(gradual_template);
		if (!template_put.ok) throw new Error("template put failed");

		const manifest_put = await version_sets.put(
			make_manifest({
				template_ref: `pipeline-templates/${template_put.value.content_hash}`,
			}),
		);
		if (!manifest_put.ok) throw new Error("manifest put failed");

		const manifests = make_corpus_manifest_provider(backend);
		const resolver = make_corpus_template_resolver(backend, manifests);

		const result = await resolver.resolve("anthropic-search", manifest_put.value.version);
		expect(result).not.toBeNull();
		if (result === null) return;
		expect(result).toEqual(gradual_template);
	});
});
