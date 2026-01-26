import { describe, expect, test } from "bun:test";
import { extractContext, extractText, matchLine, parseFileContent, shouldIgnorePath } from "../src/parser.js";
import type { ScanConfig, TagMatcher } from "../src/types.js";

const default_tags: TagMatcher[] = [
	{ name: "TODO", match: ["TODO:", "TODO "] },
	{ name: "FIXME", match: ["FIXME:", "FIXME "] },
	{ name: "HACK", match: ["HACK:", "HACK "] },
];

const jsdoc_tags: TagMatcher[] = [{ name: "TODO", match: ["@todo"] }];

describe("matchLine", () => {
	test("matches a basic // TODO: pattern", () => {
		const result = matchLine("// TODO: fix this bug", default_tags);
		expect(result).not.toBeNull();
		expect(result!.tag).toBe("TODO");
		expect(result!.match_index).toBe(3);
		expect(result!.match_length).toBe(5);
	});

	test("matches @todo in a JSDoc comment", () => {
		const result = matchLine(" * @todo implement this", jsdoc_tags);
		expect(result).not.toBeNull();
		expect(result!.tag).toBe("TODO");
		expect(result!.match_index).toBe(3);
		expect(result!.match_length).toBe(5);
	});

	test("returns null when no match", () => {
		const result = matchLine("const x = 42", default_tags);
		expect(result).toBeNull();
	});

	test("matches first tag when multiple could match", () => {
		const tags: TagMatcher[] = [
			{ name: "FIRST", match: ["TODO:"] },
			{ name: "SECOND", match: ["TODO:"] },
		];
		const result = matchLine("// TODO: something", tags);
		expect(result).not.toBeNull();
		expect(result!.tag).toBe("FIRST");
	});

	test("handles empty match strings by skipping them", () => {
		const tags: TagMatcher[] = [{ name: "TODO", match: ["", "TODO:"] }];
		const result = matchLine("// TODO: something", tags);
		expect(result).not.toBeNull();
		expect(result!.tag).toBe("TODO");
		expect(result!.match_length).toBe(5);
	});

	test("skips tags with only empty match strings", () => {
		const tags: TagMatcher[] = [{ name: "EMPTY", match: [""] }];
		const result = matchLine("// anything here", tags);
		expect(result).toBeNull();
	});
});

describe("extractText", () => {
	test("extracts text after match", () => {
		const result = extractText("// TODO: fix this bug", 3, 5);
		expect(result).toBe("fix this bug");
	});

	test("returns full line when less than 3 chars after match", () => {
		const result = extractText("// TODO: ab", 3, 5);
		expect(result).toBe("// TODO: ab");
	});

	test("returns full line when nothing after match", () => {
		const result = extractText("// TODO:", 3, 5);
		expect(result).toBe("// TODO:");
	});

	test("strips trailing */", () => {
		const result = extractText("/* TODO: fix this */", 3, 5);
		expect(result).toBe("fix this");
	});

	test("strips trailing */ with whitespace", () => {
		const result = extractText("/* TODO: fix this */  ", 3, 5);
		expect(result).toBe("fix this");
	});

	test("trims whitespace", () => {
		const result = extractText("// TODO:   fix this   ", 3, 5);
		expect(result).toBe("fix this");
	});

	test("returns trimmed full line when short text after match also has trailing */", () => {
		const result = extractText("/* TODO: */", 3, 5);
		expect(result).toBe("/* TODO:");
	});
});

describe("extractContext", () => {
	const lines = ["line0", "line1", "line2", "line3", "line4", "line5", "line6", "line7", "line8", "line9", "line10", "line11", "line12"];

	test("returns correct window for middle of file", () => {
		const result = extractContext(lines, 6);
		expect(result).toEqual(["line2", "line3", "line4", "line5", "line6", "line7", "line8", "line9", "line10", "line11"]);
		expect(result.length).toBe(10);
	});

	test("clamps to start of file", () => {
		const result = extractContext(lines, 1);
		expect(result[0]).toBe("line0");
		expect(result).toEqual(["line0", "line1", "line2", "line3", "line4", "line5", "line6"]);
	});

	test("clamps to end of file", () => {
		const result = extractContext(lines, 11);
		expect(result[result.length - 1]).toBe("line12");
		expect(result).toEqual(["line7", "line8", "line9", "line10", "line11", "line12"]);
	});

	test("works for single-line file", () => {
		const result = extractContext(["only line"], 0);
		expect(result).toEqual(["only line"]);
	});

	test("respects custom before/after parameters", () => {
		const result = extractContext(lines, 6, 2, 3);
		expect(result).toEqual(["line4", "line5", "line6", "line7", "line8"]);
	});
});

describe("parseFileContent", () => {
	const config: ScanConfig = {
		tags: default_tags,
		ignore: [],
	};

	test("parses a file with multiple TODOs", () => {
		const content = `function foo() {
  // TODO: implement foo
  return null
}
// FIXME: this is broken`;

		const tasks = parseFileContent(content, "src/foo.ts", config);
		expect(tasks.length).toBe(2);
		expect(tasks[0]!.tag).toBe("TODO");
		expect(tasks[0]!.text).toBe("implement foo");
		expect(tasks[1]!.tag).toBe("FIXME");
		expect(tasks[1]!.text).toBe("this is broken");
	});

	test("returns 1-indexed line numbers", () => {
		const content = `line one
// TODO: on line two
line three`;

		const tasks = parseFileContent(content, "test.ts", config);
		expect(tasks.length).toBe(1);
		expect(tasks[0]!.line).toBe(2);
	});

	test("generates unique IDs", () => {
		const content = `// TODO: first
// TODO: second`;

		const tasks = parseFileContent(content, "test.ts", config);
		expect(tasks.length).toBe(2);
		expect(tasks[0]!.id).not.toBe(tasks[1]!.id);
		expect(tasks[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
	});

	test("uses provided file path", () => {
		const content = "// TODO: something";
		const tasks = parseFileContent(content, "packages/core/src/index.ts", config);
		expect(tasks[0]!.file).toBe("packages/core/src/index.ts");
	});

	test("respects tag configuration", () => {
		const custom_config: ScanConfig = {
			tags: [{ name: "REVIEW", match: ["REVIEW:"] }],
			ignore: [],
		};
		const content = `// TODO: ignored
// REVIEW: needs review`;

		const tasks = parseFileContent(content, "test.ts", custom_config);
		expect(tasks.length).toBe(1);
		expect(tasks[0]!.tag).toBe("REVIEW");
	});

	test("extracts context lines around match", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
		lines[10] = "// TODO: found it";
		const content = lines.join("\n");

		const tasks = parseFileContent(content, "test.ts", config);
		expect(tasks.length).toBe(1);
		expect(tasks[0]!.context.length).toBe(10);
		expect(tasks[0]!.context[0]).toBe("line 6");
		expect(tasks[0]!.context[4]).toBe("// TODO: found it");
		expect(tasks[0]!.context[9]).toBe("line 15");
	});

	test("returns empty array for file with no matches", () => {
		const content = "const x = 42\nconst y = 'hello'";
		const tasks = parseFileContent(content, "test.ts", config);
		expect(tasks).toEqual([]);
	});
});

describe("shouldIgnorePath", () => {
	test("matches regex patterns", () => {
		expect(shouldIgnorePath("node_modules/lodash/index.js", ["node_modules"])).toBe(true);
		expect(shouldIgnorePath(".git/config", ["\\.git"])).toBe(true);
	});

	test("returns false for non-matching paths", () => {
		expect(shouldIgnorePath("src/index.ts", ["node_modules", "\\.git"])).toBe(false);
	});

	test("handles multiple patterns", () => {
		const patterns = ["node_modules", "dist", "\\.git"];
		expect(shouldIgnorePath("dist/bundle.js", patterns)).toBe(true);
		expect(shouldIgnorePath("src/app.ts", patterns)).toBe(false);
	});

	test("matches partial path with regex", () => {
		expect(shouldIgnorePath("vendor/lib/foo.js", ["vendor/"])).toBe(true);
	});

	test("handles empty patterns list", () => {
		expect(shouldIgnorePath("anything.ts", [])).toBe(false);
	});
});
