/**
 * Unit tests for the pure scaffolder domain layer in
 * `@devpad/pipeline-templates/scaffolder`. Every function under test is
 * deterministic — no IO, no clock injection beyond `now: Date`. Tests are
 * table-driven across the rollout × gate matrix.
 */

import { describe, expect, test } from "bun:test";
import {
	compute_compatibility_date,
	derive_template_vars,
	render_template,
	type ScaffolderInput,
	validate_package_name,
} from "@devpad/pipeline-templates";

describe("validate_package_name", () => {
	const valid_cases = ["anthropic-search", "a", "abc-123", "x".repeat(40), "service-with-many-hyphens"];
	for (const name of valid_cases) {
		test(`accepts "${name}"`, () => {
			const result = validate_package_name(name);
			expect(result.ok).toBe(true);
		});
	}

	const invalid_cases: Array<{
		name: string;
		expected_code: "package_name_empty" | "package_name_too_long" | "package_name_invalid_chars";
	}> = [
		{ name: "", expected_code: "package_name_empty" },
		{ name: "x".repeat(41), expected_code: "package_name_too_long" },
		{ name: "Anthropic-Search", expected_code: "package_name_invalid_chars" },
		{ name: "anthropic_search", expected_code: "package_name_invalid_chars" },
		{ name: "1anthropic", expected_code: "package_name_invalid_chars" },
		{ name: "-anthropic", expected_code: "package_name_invalid_chars" },
		{ name: "anthropic search", expected_code: "package_name_invalid_chars" },
		{ name: "anthropic.search", expected_code: "package_name_invalid_chars" },
	];
	for (const { name, expected_code } of invalid_cases) {
		test(`rejects "${name}" with ${expected_code}`, () => {
			const result = validate_package_name(name);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.code).toBe(expected_code);
		});
	}
});

describe("compute_compatibility_date", () => {
	test("formats UTC YYYY-MM-DD", () => {
		expect(compute_compatibility_date(new Date(Date.UTC(2026, 4, 17, 12, 34, 56)))).toBe("2026-05-17");
	});

	test("zero-pads month and day", () => {
		expect(compute_compatibility_date(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("2026-01-01");
	});

	test("is timezone-stable (uses UTC, not local)", () => {
		// Midnight UTC on Jan 1 — in any timezone this should still be Jan 1.
		const d = new Date("2026-01-01T00:00:00.000Z");
		expect(compute_compatibility_date(d)).toBe("2026-01-01");
	});
});

describe("derive_template_vars", () => {
	const base_input: ScaffolderInput = {
		package_name: "anthropic-search",
		rollout: "gradual",
		default_gate: "auto",
		build_shape: "single-file",
		now: new Date(Date.UTC(2026, 4, 17)),
	};

	test("produces stable pascal + constant casings", () => {
		const vars = derive_template_vars(base_input);
		expect(vars.package_name).toBe("anthropic-search");
		expect(vars.package_name_pascal).toBe("AnthropicSearch");
		expect(vars.package_name_constant).toBe("ANTHROPIC_SEARCH");
	});

	test("captures compatibility_date from injected now", () => {
		const vars = derive_template_vars(base_input);
		expect(vars.compatibility_date).toBe("2026-05-17");
	});

	test("gradual rollout emits the gradual stages block", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "gradual" });
		expect(vars.rollout_block).toContain('type: "gradual"');
		expect(vars.rollout_block).toContain("stages:");
	});

	test("atomic rollout emits a one-liner", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "atomic" });
		expect(vars.rollout_block).toContain('type: "atomic"');
		expect(vars.rollout_block).not.toContain("stages:");
	});

	test("gates block for gradual+auto uses auto({ afterBake: true }) on every transition", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "gradual", default_gate: "auto" });
		expect(vars.gates_block).toContain("staging→onebox");
		expect(vars.gates_block).toContain("onebox→wave1");
		expect(vars.gates_block).toContain("wave1→wave2");
		expect(vars.gates_block).toContain("wave2→full");
		expect(vars.gates_block).toContain("auto({ afterBake: true })");
		expect(vars.gate_import).toBe("auto");
	});

	test("gates block for gradual+manual uses manual()", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "gradual", default_gate: "manual" });
		expect(vars.gates_block).toContain("manual()");
		expect(vars.gate_import).toBe("manual");
	});

	test("gates block for gradual+analysis uses analysis() with a template_id", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "gradual", default_gate: "analysis" });
		expect(vars.gates_block).toContain("analysis(");
		expect(vars.gates_block).toContain("template_id");
		expect(vars.gate_import).toBe("analysis");
	});

	test("gates block for atomic+auto uses the single staging→atomic-prod transition", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "atomic", default_gate: "auto" });
		expect(vars.gates_block).toContain("staging→atomic-prod");
		expect(vars.gates_block).toContain("auto()");
		expect(vars.gates_block).not.toContain("onebox");
	});

	test("gates block for atomic+manual uses manual()", () => {
		const vars = derive_template_vars({ ...base_input, rollout: "atomic", default_gate: "manual" });
		expect(vars.gates_block).toContain("staging→atomic-prod");
		expect(vars.gates_block).toContain("manual()");
	});
});

describe("render_template", () => {
	test("substitutes a single placeholder", () => {
		const result = render_template("hello {{name}}", { name: "world" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe("hello world");
	});

	test("substitutes repeated placeholders", () => {
		const result = render_template("{{a}} {{a}} {{b}}", { a: "x", b: "y" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe("x x y");
	});

	test("substitutes placeholders with whitespace inside braces", () => {
		const result = render_template("hello {{  name  }}", { name: "world" });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toBe("hello world");
	});

	test("returns missing_var on unknown variable", () => {
		const result = render_template("hello {{nope}}", { name: "world" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("missing_var");
			expect(result.error.var).toBe("nope");
		}
	});

	test("leaves non-placeholder text untouched", () => {
		const result = render_template("// comment // {{x}}", { x: "1" });
		if (result.ok) expect(result.value).toBe("// comment // 1");
	});

	test("substitutes multiple variables in a single template", () => {
		const result = render_template("{{a}}/{{b}}/{{c}}", { a: "1", b: "2", c: "3" });
		if (result.ok) expect(result.value).toBe("1/2/3");
	});

	test("template_snippet on error contains the missing var", () => {
		const result = render_template("....prefix {{missing_var_name}} suffix....", {});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.template_snippet).toContain("missing_var_name");
	});
});
