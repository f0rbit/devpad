import { describe, expect, test } from "bun:test";
import type { Stage } from "@devpad/pipeline-templates";
import { build_deployment_request, type DeployRequest } from "../../deploy.js";

const make = (overrides: Partial<DeployRequest> = {}): DeployRequest => ({
	script_name: "my-worker",
	stage: { name: "full", traffic: 100, bake: null },
	version_set_id: "vs_v1",
	current_version_id: "ver_new",
	previous_active_version_id: "ver_old",
	...overrides,
});

const stage = (name: string, traffic: number): Stage => ({ name, traffic, bake: null });

describe("build_deployment_request", () => {
	test("100% stage uses single-version strategy at 100", () => {
		const r = build_deployment_request(make({ stage: stage("full", 100) }));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.strategy.versions).toHaveLength(1);
			expect(r.value.strategy.versions[0]).toEqual({ version_id: "ver_new", percentage: 100 });
		}
	});

	test("0% staging stage uses single-version strategy at 100 (env-routed elsewhere)", () => {
		const r = build_deployment_request(make({ stage: stage("staging", 0) }));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.strategy.versions).toHaveLength(1);
			expect(r.value.strategy.versions[0].percentage).toBe(100);
		}
	});

	test("partial traffic stage uses two-version strategy", () => {
		const r = build_deployment_request(make({ stage: stage("onebox", 1) }));
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.strategy.versions).toHaveLength(2);
			expect(r.value.strategy.versions[0]).toEqual({ version_id: "ver_new", percentage: 1 });
			expect(r.value.strategy.versions[1]).toEqual({ version_id: "ver_old", percentage: 99 });
		}
	});

	test("partial traffic without a previous version errors", () => {
		const r = build_deployment_request(make({ stage: stage("onebox", 1), previous_active_version_id: null }));
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.code).toBe("validation");
		}
	});

	test("percentages always sum to 100", () => {
		for (const traffic of [1, 10, 50, 99]) {
			const r = build_deployment_request(make({ stage: stage("wave", traffic) }));
			expect(r.ok).toBe(true);
			if (r.ok) {
				const total = r.value.strategy.versions.reduce((acc, v) => acc + v.percentage, 0);
				expect(total).toBe(100);
			}
		}
	});

	test("script_name is propagated", () => {
		const r = build_deployment_request(make({ script_name: "other-worker" }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.script_name).toBe("other-worker");
	});
});
