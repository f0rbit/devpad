/**
 * Pure unit tests for the JSON ⇄ PipelineTemplate round-trip helpers.
 *
 * These cover the deterministic, in-memory pieces of the compile step.
 * The bundling + dynamic-import path (`compile_pipeline_ts`) is covered
 * by the integration test that writes a real `pipeline.ts` to disk.
 */

import { describe, test, expect } from "bun:test";
import type { PipelineTemplate } from "@devpad/pipeline-templates";
import { compile_template_to_json, parse_template_from_json } from "../../src/pipelines-artifacts-helpers";

const atomic_template: PipelineTemplate = {
	rollout: { type: "atomic" },
	gates: { "staging→atomic-prod": { type: "auto" } },
	pre_deploy_checks: [],
	post_deploy_checks: [],
};

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
		"onebox→wave1": { type: "auto", afterBake: true },
		"wave1→full": { type: "analysis", template: { template_id: "default" } },
	},
	pre_deploy_checks: [{ kind: "no_deploy_window", policy: "weekday" }],
	post_deploy_checks: [],
};

describe("compile_template_to_json", () => {
	test("serialises an atomic template to JSON", () => {
		const result = compile_template_to_json(atomic_template);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const decoded = JSON.parse(result.value);
		expect(decoded.rollout.type).toBe("atomic");
		expect(decoded.gates["staging→atomic-prod"]).toEqual({ type: "auto" });
	});

	test("serialises a gradual template with stages + gates", () => {
		const result = compile_template_to_json(gradual_template);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const decoded = JSON.parse(result.value);
		expect(decoded.rollout.type).toBe("gradual");
		expect(decoded.rollout.stages).toHaveLength(3);
		expect(decoded.gates["wave1→full"].type).toBe("analysis");
	});

	test("rejects shapes missing required fields", () => {
		const broken = { rollout: { type: "atomic" } } as unknown as PipelineTemplate;
		const result = compile_template_to_json(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_a_template");
	});

	test("rejects unknown rollout types", () => {
		const broken = {
			rollout: { type: "exponential" },
			gates: {},
			pre_deploy_checks: [],
			post_deploy_checks: [],
		} as unknown as PipelineTemplate;
		const result = compile_template_to_json(broken);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_a_template");
	});
});

describe("parse_template_from_json", () => {
	test("round-trips an atomic template byte-for-byte", () => {
		const json = compile_template_to_json(atomic_template);
		expect(json.ok).toBe(true);
		if (!json.ok) return;
		const parsed = parse_template_from_json(json.value);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value).toEqual(atomic_template);
	});

	test("round-trips a gradual template byte-for-byte", () => {
		const json = compile_template_to_json(gradual_template);
		expect(json.ok).toBe(true);
		if (!json.ok) return;
		const parsed = parse_template_from_json(json.value);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value).toEqual(gradual_template);
	});

	test("rejects malformed JSON", () => {
		const result = parse_template_from_json("not json {");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_a_template");
	});

	test("rejects valid JSON that isn't a PipelineTemplate", () => {
		const result = parse_template_from_json(JSON.stringify({ hello: "world" }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_a_template");
	});

	test("rejects a malformed gate shape", () => {
		const result = parse_template_from_json(
			JSON.stringify({
				rollout: { type: "atomic" },
				gates: { "staging→atomic-prod": { type: "unrecognised" } },
				pre_deploy_checks: [],
				post_deploy_checks: [],
			}),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("not_a_template");
	});
});
