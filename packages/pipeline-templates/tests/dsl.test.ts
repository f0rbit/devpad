import { describe, expect, test } from "bun:test";
import { defaultAtomic, defaultAtomicGates, defaultGradual, defaultGradualGates, extendTemplate } from "../src/index.ts";

const unwrap_ok = <T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T => {
	if (!r.ok) throw new Error(`expected ok, got err: ${JSON.stringify(r.error)}`);
	return r.value;
};
const unwrap_err = <T, E>(r: { ok: true; value: T } | { ok: false; error: E }): E => {
	if (r.ok) throw new Error(`expected err, got ok: ${JSON.stringify(r.value)}`);
	return r.error;
};

describe("extendTemplate", () => {
	test("no-op override returns defaults deeply equal", () => {
		const tpl = unwrap_ok(extendTemplate());
		expect(tpl.rollout).toEqual(defaultGradual);
		expect(tpl.gates).toEqual(defaultGradualGates);
		expect(tpl.pre_deploy_checks).toEqual([]);
		expect(tpl.post_deploy_checks).toEqual([]);
	});

	test("empty overrides object is equivalent to no-op", () => {
		const tpl = unwrap_ok(extendTemplate({}));
		expect(tpl.rollout).toEqual(defaultGradual);
		expect(tpl.gates).toEqual(defaultGradualGates);
	});

	test("returned template is deep-cloned from defaults (mutation safety)", () => {
		const tpl = unwrap_ok(extendTemplate());
		if (tpl.rollout.type !== "gradual") throw new Error("expected gradual base");
		tpl.rollout.stages[0].traffic = 99;
		// Default is untouched.
		expect(defaultGradual.type === "gradual" && defaultGradual.stages[0].traffic).toBe(1);
	});

	test("partial stage override — traffic only, keeps default bake", () => {
		const tpl = unwrap_ok(extendTemplate({ rollout: { stages: [{ name: "onebox", traffic: 5 }] } }));
		if (tpl.rollout.type !== "gradual") throw new Error("expected gradual");
		const onebox = tpl.rollout.stages.find(s => s.name === "onebox");
		expect(onebox?.traffic).toBe(5);
		expect(onebox?.bake).toEqual({ ms: 30 * 60_000 });
		// Other stages untouched.
		const wave1 = tpl.rollout.stages.find(s => s.name === "wave1");
		expect(wave1?.traffic).toBe(10);
	});

	test("partial stage override — bake only as `{ms}`", () => {
		const tpl = unwrap_ok(extendTemplate({ rollout: { stages: [{ name: "wave1", bake: { ms: 5_000 } }] } }));
		if (tpl.rollout.type !== "gradual") throw new Error("expected gradual");
		const wave1 = tpl.rollout.stages.find(s => s.name === "wave1");
		expect(wave1?.bake).toEqual({ ms: 5_000 });
		expect(wave1?.traffic).toBe(10);
	});

	test("partial stage override — bake only as duration string", () => {
		const tpl = unwrap_ok(extendTemplate({ rollout: { stages: [{ name: "wave1", bake: "5m" }] } }));
		if (tpl.rollout.type !== "gradual") throw new Error("expected gradual");
		const wave1 = tpl.rollout.stages.find(s => s.name === "wave1");
		expect(wave1?.bake).toEqual({ ms: 5 * 60_000 });
	});

	test("multiple stage overrides merge by name independently", () => {
		const tpl = unwrap_ok(
			extendTemplate({
				rollout: {
					stages: [
						{ name: "onebox", traffic: 5 },
						{ name: "full", bake: "1h" },
					],
				},
			})
		);
		if (tpl.rollout.type !== "gradual") throw new Error("expected gradual");
		expect(tpl.rollout.stages.find(s => s.name === "onebox")?.traffic).toBe(5);
		expect(tpl.rollout.stages.find(s => s.name === "full")?.bake).toEqual({ ms: 3_600_000 });
		// Default-only stages preserved.
		expect(tpl.rollout.stages.find(s => s.name === "wave2")?.traffic).toBe(50);
	});

	test("gate override by transition key", () => {
		const tpl = unwrap_ok(extendTemplate({ gates: { "onebox→wave1": { type: "auto" } } }));
		expect(tpl.gates["onebox→wave1"]).toEqual({ type: "auto" });
		// Other gates preserved.
		expect(tpl.gates["staging→onebox"]).toEqual({ type: "manual" });
	});

	test("gate override to analysis type", () => {
		const tpl = unwrap_ok(
			extendTemplate({
				gates: {
					"wave1→wave2": {
						type: "analysis",
						template: { template_id: "default-error-rate" },
					},
				},
			})
		);
		expect(tpl.gates["wave1→wave2"]).toEqual({
			type: "analysis",
			template: { template_id: "default-error-rate" },
		});
	});

	test("unknown stage name in override → err(unknown_stage)", () => {
		const result = extendTemplate({
			rollout: { stages: [{ name: "no-such-stage", traffic: 5 }] },
		});
		const error = unwrap_err(result);
		expect(error.code).toBe("unknown_stage");
		if (error.code !== "unknown_stage") throw new Error("type narrow");
		expect(error.stage).toBe("no-such-stage");
	});

	test("unknown transition key in override → err(unknown_transition)", () => {
		const result = extendTemplate({
			gates: { "foo→bar": { type: "manual" } } as Record<`${string}→${string}`, { type: "manual" }>,
		});
		const error = unwrap_err(result);
		expect(error.code).toBe("unknown_transition");
		if (error.code !== "unknown_transition") throw new Error("type narrow");
		expect(error.transition).toBe("foo→bar");
	});

	test("invalid duration string in stage override → err(duration_parse)", () => {
		const result = extendTemplate({
			rollout: { stages: [{ name: "onebox", bake: "thirty-minutes" }] },
		});
		const error = unwrap_err(result);
		expect(error.code).toBe("duration_parse");
	});

	test("rollout: { type: 'atomic' } switches to atomic base + atomic gates", () => {
		const tpl = unwrap_ok(extendTemplate({ rollout: { type: "atomic" } }));
		expect(tpl.rollout).toEqual(defaultAtomic);
		expect(tpl.gates).toEqual(defaultAtomicGates);
	});

	test("atomic mode + gate override on staging→atomic-prod", () => {
		const tpl = unwrap_ok(
			extendTemplate({
				rollout: { type: "atomic" },
				gates: { "staging→atomic-prod": { type: "auto" } },
			})
		);
		expect(tpl.gates["staging→atomic-prod"]).toEqual({ type: "auto" });
	});

	test("atomic mode rejects gradual stage names in gates", () => {
		const result = extendTemplate({
			rollout: { type: "atomic" },
			gates: { "staging→onebox": { type: "auto" } },
		});
		const error = unwrap_err(result);
		expect(error.code).toBe("unknown_transition");
	});

	test("full override replaces every stage field", () => {
		const tpl = unwrap_ok(
			extendTemplate({
				rollout: {
					stages: [
						{ name: "onebox", traffic: 2, bake: "10m" },
						{ name: "wave1", traffic: 20, bake: "30m" },
						{ name: "wave2", traffic: 60, bake: "1h" },
						{ name: "full", traffic: 100, bake: "0" },
					],
				},
				gates: {
					"staging→onebox": { type: "auto" },
					"onebox→wave1": { type: "auto" },
					"wave1→wave2": { type: "auto" },
					"wave2→full": { type: "auto" },
				},
			})
		);
		if (tpl.rollout.type !== "gradual") throw new Error("expected gradual");
		expect(tpl.rollout.stages[0]).toEqual({ name: "onebox", traffic: 2, bake: { ms: 600_000 } });
		expect(tpl.gates["staging→onebox"]).toEqual({ type: "auto" });
	});

	test("pre_deploy_checks / post_deploy_checks pass through (Phase 1 empty default)", () => {
		const tpl = unwrap_ok(extendTemplate());
		expect(tpl.pre_deploy_checks).toEqual([]);
		expect(tpl.post_deploy_checks).toEqual([]);
		const tpl2 = unwrap_ok(
			extendTemplate({
				pre_deploy_checks: [{ kind: "blocker", policy: "business-hours" }],
			})
		);
		expect(tpl2.pre_deploy_checks).toEqual([{ kind: "blocker", policy: "business-hours" }]);
	});

	test("auto gate with afterBake flag preserved through override", () => {
		const tpl = unwrap_ok(extendTemplate({ gates: { "onebox→wave1": { type: "auto", afterBake: true } } }));
		expect(tpl.gates["onebox→wave1"]).toEqual({ type: "auto", afterBake: true });
	});
});
