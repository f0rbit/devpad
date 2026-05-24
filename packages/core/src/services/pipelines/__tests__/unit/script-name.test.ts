import { describe, test, expect } from "bun:test";
import { resolve_script_name, type ScriptNameInput } from "../../script-name";

describe("resolve_script_name", () => {
	test("staging stage with no overrides returns {name}-staging", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: null,
			},
			stage_name: "staging",
		};
		expect(resolve_script_name(input)).toBe("anthropic-search-staging");
	});

	test("production stage with no overrides returns {name}", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: null,
			},
			stage_name: "prod",
		};
		expect(resolve_script_name(input)).toBe("anthropic-search");
	});

	test("staging stage with explicit override uses the override", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: {
					staging: "custom-staging-script",
				},
			},
			stage_name: "staging",
		};
		expect(resolve_script_name(input)).toBe("custom-staging-script");
	});

	test("production stage with explicit override uses the override", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: {
					prod: "custom-prod-script",
				},
			},
			stage_name: "prod",
		};
		expect(resolve_script_name(input)).toBe("custom-prod-script");
	});

	test("unknown stage falls through to convention", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: null,
			},
			stage_name: "wave1",
		};
		expect(resolve_script_name(input)).toBe("anthropic-search");
	});

	test("empty overrides object is treated as no override", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: {},
			},
			stage_name: "staging",
		};
		expect(resolve_script_name(input)).toBe("anthropic-search-staging");
	});

	test("throws on empty package name", () => {
		const input: ScriptNameInput = {
			package: {
				name: "",
				script_name_overrides: null,
			},
			stage_name: "staging",
		};
		expect(() => resolve_script_name(input)).toThrow("Package name is required");
	});

	test("throws on empty stage name", () => {
		const input: ScriptNameInput = {
			package: {
				name: "anthropic-search",
				script_name_overrides: null,
			},
			stage_name: "",
		};
		expect(() => resolve_script_name(input)).toThrow("Stage name is required");
	});

	test("handles atomic production stage names (atomic-prod, full)", () => {
		const test_cases = [
			{ stage: "atomic-prod", expected: "anthropic-search" },
			{ stage: "prod-onebox", expected: "anthropic-search" },
			{ stage: "wave2", expected: "anthropic-search" },
			{ stage: "full", expected: "anthropic-search" },
		];

		for (const { stage, expected } of test_cases) {
			const input: ScriptNameInput = {
				package: {
					name: "anthropic-search",
					script_name_overrides: null,
				},
				stage_name: stage,
			};
			expect(resolve_script_name(input)).toBe(expected);
		}
	});
});
