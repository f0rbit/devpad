import { describe, expect, test } from "bun:test";
import { classify_diff, normalize_declarations } from "../../interface-report.js";

describe("normalize_declarations — deterministic, machine-independent (task A4.4)", () => {
	test("running normalization twice over the same fixture produces an identical result", () => {
		const files = [
			{ path: "index.d.ts", content: "/** Doc comment */\nexport function foo(): void;\n// trailing comment\n" },
			{ path: "types.d.ts", content: "export type Bar = { a: number;   b: string };\n\n\n" },
		];

		const first = normalize_declarations(files);
		const second = normalize_declarations(files);

		expect(first).toBe(second);
	});

	test("strips comments and blank lines while keeping declaration content", () => {
		const files = [
			{ path: "index.d.ts", content: "/**\n * A function.\n */\nexport function foo(): void;\n\n// note\n" },
		];

		const result = normalize_declarations(files);

		expect(result).not.toContain("A function");
		expect(result).not.toContain("note");
		expect(result).toContain("export function foo(): void;");
	});

	test("stable file order regardless of input order", () => {
		const a = [
			{ path: "b.d.ts", content: "export type B = number;" },
			{ path: "a.d.ts", content: "export type A = string;" },
		];
		const b = [
			{ path: "a.d.ts", content: "export type A = string;" },
			{ path: "b.d.ts", content: "export type B = number;" },
		];

		expect(normalize_declarations(a)).toBe(normalize_declarations(b));
	});

	test("canonicalizes whitespace differences that carry no semantic meaning", () => {
		const spaced = [{ path: "index.d.ts", content: "export   type    A   =   string;" }];
		const tight = [{ path: "index.d.ts", content: "export type A = string;" }];

		expect(normalize_declarations(spaced)).toBe(normalize_declarations(tight));
	});

	test("never embeds an absolute path or a timestamp", () => {
		const files = [{ path: "src/index.d.ts", content: "export type A = string;" }];
		const result = normalize_declarations(files);

		expect(result).not.toMatch(/file: \//);
		expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
	});
});

describe("classify_diff — pure, line-based, conservative (task A4.4)", () => {
	test("no change classifies unchanged", () => {
		const text = "export type A = string;\nexport type B = number;";
		expect(classify_diff(text, text)).toBe("unchanged");
	});

	test("adding a new declaration classifies additive", () => {
		const before = "export type A = string;";
		const after = "export type A = string;\nexport type B = number;";
		expect(classify_diff(before, after)).toBe("additive");
	});

	test("inserting a new line in the middle still classifies additive", () => {
		const before = "export type A = string;\nexport type C = boolean;";
		const after = "export type A = string;\nexport type B = number;\nexport type C = boolean;";
		expect(classify_diff(before, after)).toBe("additive");
	});

	test("removing any declaration classifies breaking", () => {
		const before = "export type A = string;\nexport type B = number;";
		const after = "export type A = string;";
		expect(classify_diff(before, after)).toBe("breaking");
	});

	test("changing an existing declaration's signature classifies breaking", () => {
		const before = "export function foo(a: string): void;";
		const after = "export function foo(a: number): void;";
		expect(classify_diff(before, after)).toBe("breaking");
	});

	test("reordering existing declarations classifies breaking (never a false additive)", () => {
		const before = "export type A = string;\nexport type B = number;";
		const after = "export type B = number;\nexport type A = string;";
		expect(classify_diff(before, after)).toBe("breaking");
	});
});
