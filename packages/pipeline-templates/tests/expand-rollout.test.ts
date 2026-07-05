import { describe, expect, test } from "bun:test";
import { defaultAtomic, defaultGradual, expand_rollout, extendTemplate } from "../src/index";

const unwrap_ok = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!r.ok) throw new Error(`expected ok, got err: ${JSON.stringify(r.error)}`);
	return r.value;
};

describe("expand_rollout", () => {
	test("atomic expands to staging + atomic-prod", () => {
		const stages = expand_rollout(defaultAtomic);
		expect(stages).toEqual([
			{ name: "staging", traffic: 0, bake: null },
			{ name: "atomic-prod", traffic: 100, bake: null },
		]);
	});

	test("default gradual expands to staging + 4 declared stages", () => {
		const stages = expand_rollout(defaultGradual);
		expect(stages.map((s) => s.name)).toEqual(["staging", "onebox", "wave1", "wave2", "full"]);
		expect(stages.map((s) => s.traffic)).toEqual([0, 1, 10, 50, 100]);
	});

	test("default gradual carries bake windows verbatim onto each stage", () => {
		const stages = expand_rollout(defaultGradual);
		expect(stages.find((s) => s.name === "onebox")?.bake).toEqual({ ms: 30 * 60_000 });
		expect(stages.find((s) => s.name === "wave1")?.bake).toEqual({ ms: 60 * 60_000 });
		expect(stages.find((s) => s.name === "wave2")?.bake).toEqual({ ms: 120 * 60_000 });
		expect(stages.find((s) => s.name === "full")?.bake).toEqual({ ms: 0 });
	});

	test("gradual + DSL override expands with override values", () => {
		const tpl = unwrap_ok(
			extendTemplate({
				rollout: { stages: [{ name: "onebox", traffic: 5, bake: "10m" }] },
			}),
		);
		const stages = expand_rollout(tpl.rollout);
		const onebox = stages.find((s) => s.name === "onebox");
		expect(onebox?.traffic).toBe(5);
		expect(onebox?.bake).toEqual({ ms: 600_000 });
		// Other stages keep defaults.
		expect(stages.find((s) => s.name === "wave1")?.traffic).toBe(10);
	});

	test("stage[0] of any rollout is always 'staging' (orchestrator entry point)", () => {
		expect(expand_rollout(defaultGradual)[0].name).toBe("staging");
		expect(expand_rollout(defaultAtomic)[0].name).toBe("staging");
		expect(expand_rollout({ type: "gradual", stages: [{ name: "x", traffic: 100, bake: { ms: 0 } }] })[0].name).toBe(
			"staging",
		);
	});
});
