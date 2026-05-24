import { describe, expect, test } from "bun:test";
import { defaultAtomic, defaultAtomicGates, defaultGradual, defaultGradualGates } from "../src/index.ts";

describe("defaultGradual", () => {
	test("has exactly 4 stages in the architecture-spec order", () => {
		if (defaultGradual.type !== "gradual") throw new Error("expected gradual");
		expect(defaultGradual.stages.map(s => s.name)).toEqual(["onebox", "wave1", "wave2", "full"]);
	});

	test("traffic schedule is 1 / 10 / 50 / 100", () => {
		if (defaultGradual.type !== "gradual") throw new Error("expected gradual");
		expect(defaultGradual.stages.map(s => s.traffic)).toEqual([1, 10, 50, 100]);
	});

	test("bake windows are 30m / 1h / 2h / 0", () => {
		if (defaultGradual.type !== "gradual") throw new Error("expected gradual");
		expect(defaultGradual.stages.map(s => s.bake.ms)).toEqual([30 * 60_000, 60 * 60_000, 120 * 60_000, 0]);
	});

	test("traffic values are strictly monotonic", () => {
		if (defaultGradual.type !== "gradual") throw new Error("expected gradual");
		const values = defaultGradual.stages.map(s => s.traffic);
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeGreaterThan(values[i - 1]);
		}
	});
});

describe("defaultGradualGates", () => {
	test("staging→onebox is manual (first prod traffic)", () => {
		expect(defaultGradualGates["staging→onebox"]).toEqual({ type: "manual" });
	});

	test("every later transition is auto with afterBake: true", () => {
		expect(defaultGradualGates["onebox→wave1"]).toEqual({ type: "auto", afterBake: true });
		expect(defaultGradualGates["wave1→wave2"]).toEqual({ type: "auto", afterBake: true });
		expect(defaultGradualGates["wave2→full"]).toEqual({ type: "auto", afterBake: true });
	});

	test("covers every default-gradual transition exactly once", () => {
		const transitions = Object.keys(defaultGradualGates);
		expect(transitions).toEqual(["staging→onebox", "onebox→wave1", "wave1→wave2", "wave2→full"]);
	});
});

describe("defaultAtomic", () => {
	test("is the atomic singleton (no stages field)", () => {
		expect(defaultAtomic).toEqual({ type: "atomic" });
	});
});

describe("defaultAtomicGates", () => {
	test("only transition is staging→atomic-prod, defaulting to manual", () => {
		expect(defaultAtomicGates).toEqual({ "staging→atomic-prod": { type: "manual" } });
	});
});
