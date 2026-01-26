import { describe, expect, test } from "bun:test";
import { extractDiffInfo, generateDiff, sameText } from "../src/diff.js";
import type { ParsedTask } from "../src/types.js";

const task = (overrides: Partial<ParsedTask> = {}): ParsedTask => ({
	id: crypto.randomUUID(),
	file: "src/index.ts",
	line: 10,
	tag: "TODO",
	text: "fix this",
	context: ["line before", "// TODO: fix this", "line after"],
	...overrides,
});

describe("sameText", () => {
	test("matches identical strings", () => {
		expect(sameText("hello world", "hello world")).toBe(true);
	});

	test("matches strings with different whitespace", () => {
		expect(sameText("  hello world  ", "hello world")).toBe(true);
		expect(sameText("hello world", "  hello world  ")).toBe(true);
		expect(sameText("\thello\n", "hello")).toBe(true);
	});

	test("returns false for different strings", () => {
		expect(sameText("hello", "world")).toBe(false);
		expect(sameText("hello world", "hello")).toBe(false);
	});
});

describe("extractDiffInfo", () => {
	test("extracts DiffInfo from ParsedTask", () => {
		const t = task({ text: "my text", line: 5, file: "foo.ts", context: ["a", "b"] });
		const info = extractDiffInfo(t);
		expect(info).toEqual({
			text: "my text",
			line: 5,
			file: "foo.ts",
			context: ["a", "b"],
		});
	});
});

describe("generateDiff", () => {
	test("returns SAME for unchanged tasks", () => {
		const old_task = task({ id: "old-id", text: "fix bug", line: 10, file: "a.ts" });
		const new_task = task({ id: "new-id", text: "fix bug", line: 10, file: "a.ts" });

		const diffs = generateDiff([old_task], [new_task]);
		expect(diffs.length).toBe(1);
		expect(diffs[0]!.type).toBe("SAME");
		expect(diffs[0]!.id).toBe("old-id");
	});

	test("returns MOVE for tasks that moved files", () => {
		const old_task = task({ id: "old-id", text: "fix bug", line: 10, file: "a.ts" });
		const new_task = task({ id: "new-id", text: "fix bug", line: 10, file: "b.ts" });

		const diffs = generateDiff([old_task], [new_task]);
		expect(diffs.length).toBe(1);
		expect(diffs[0]!.type).toBe("MOVE");
		expect(diffs[0]!.id).toBe("old-id");
		expect(diffs[0]!.data.old!.file).toBe("a.ts");
		expect(diffs[0]!.data.new!.file).toBe("b.ts");
	});

	test("returns MOVE for tasks that moved lines", () => {
		const old_task = task({ id: "old-id", text: "fix bug", line: 10, file: "a.ts" });
		const new_task = task({ id: "new-id", text: "fix bug", line: 20, file: "a.ts" });

		const diffs = generateDiff([old_task], [new_task]);
		expect(diffs.length).toBe(1);
		expect(diffs[0]!.type).toBe("MOVE");
		expect(diffs[0]!.id).toBe("old-id");
		expect(diffs[0]!.data.old!.line).toBe(10);
		expect(diffs[0]!.data.new!.line).toBe(20);
	});

	test("returns UPDATE for tasks with same line/tag but different text", () => {
		const old_task = task({ id: "old-id", text: "old text", line: 10, tag: "TODO", file: "a.ts" });
		const new_task = task({ id: "new-id", text: "new text", line: 10, tag: "TODO", file: "a.ts" });

		const diffs = generateDiff([old_task], [new_task]);
		expect(diffs.length).toBe(1);
		expect(diffs[0]!.type).toBe("UPDATE");
		expect(diffs[0]!.id).toBe("old-id");
		expect(diffs[0]!.data.old!.text).toBe("old text");
		expect(diffs[0]!.data.new!.text).toBe("new text");
	});

	test("returns NEW for tasks not in old set", () => {
		const new_task = task({ id: "new-id", text: "brand new" });

		const diffs = generateDiff([], [new_task]);
		expect(diffs.length).toBe(1);
		expect(diffs[0]!.type).toBe("NEW");
		expect(diffs[0]!.id).toBe("new-id");
		expect(diffs[0]!.data.old).toBeNull();
		expect(diffs[0]!.data.new).not.toBeNull();
	});

	test("returns DELETE for tasks not in new set", () => {
		const old_task = task({ id: "old-id", text: "removed task" });

		const diffs = generateDiff([old_task], []);
		expect(diffs.length).toBe(1);
		expect(diffs[0]!.type).toBe("DELETE");
		expect(diffs[0]!.id).toBe("old-id");
		expect(diffs[0]!.data.old).not.toBeNull();
		expect(diffs[0]!.data.new).toBeNull();
	});

	test("handles empty old tasks (all NEW)", () => {
		const new_tasks = [task({ id: "a", text: "first" }), task({ id: "b", text: "second" })];

		const diffs = generateDiff([], new_tasks);
		expect(diffs.length).toBe(2);
		expect(diffs.every(d => d.type === "NEW")).toBe(true);
	});

	test("handles empty new tasks (all DELETE)", () => {
		const old_tasks = [task({ id: "a", text: "first" }), task({ id: "b", text: "second" })];

		const diffs = generateDiff(old_tasks, []);
		expect(diffs.length).toBe(2);
		expect(diffs.every(d => d.type === "DELETE")).toBe(true);
	});

	test("handles empty both (no diffs)", () => {
		const diffs = generateDiff([], []);
		expect(diffs).toEqual([]);
	});

	test("preserves old task ID for SAME/MOVE/UPDATE", () => {
		const old_tasks = [
			task({ id: "old-same", text: "same text", line: 1, file: "a.ts", tag: "TODO" }),
			task({ id: "old-move", text: "move text", line: 5, file: "a.ts", tag: "TODO" }),
			task({ id: "old-update", text: "old update", line: 10, file: "a.ts", tag: "FIXME" }),
		];
		const new_tasks = [
			task({ id: "new-same", text: "same text", line: 1, file: "a.ts", tag: "TODO" }),
			task({ id: "new-move", text: "move text", line: 15, file: "b.ts", tag: "TODO" }),
			task({ id: "new-update", text: "new update", line: 10, file: "a.ts", tag: "FIXME" }),
		];

		const diffs = generateDiff(old_tasks, new_tasks);
		const same = diffs.find(d => d.type === "SAME");
		const move = diffs.find(d => d.type === "MOVE");
		const update = diffs.find(d => d.type === "UPDATE");

		expect(same).toBeDefined();
		expect(same!.id).toBe("old-same");
		expect(move).toBeDefined();
		expect(move!.id).toBe("old-move");
		expect(update).toBeDefined();
		expect(update!.id).toBe("old-update");
	});

	test("uses new task ID for NEW", () => {
		const new_task = task({ id: "new-task-id", text: "something new" });

		const diffs = generateDiff([], [new_task]);
		expect(diffs[0]!.id).toBe("new-task-id");
	});

	test("text match takes precedence over line+tag match", () => {
		const old_task = task({ id: "old-id", text: "fix bug", line: 10, tag: "TODO", file: "a.ts" });
		const new_task = task({ id: "new-id", text: "fix bug", line: 10, tag: "TODO", file: "a.ts" });

		const diffs = generateDiff([old_task], [new_task]);
		expect(diffs[0]!.type).toBe("SAME");
	});

	test("does not reuse old tasks for multiple matches", () => {
		const old_task = task({ id: "old-id", text: "fix bug", line: 10 });
		const new_tasks = [task({ id: "new-1", text: "fix bug", line: 10 }), task({ id: "new-2", text: "fix bug", line: 20 })];

		const diffs = generateDiff([old_task], new_tasks);
		const same_or_move = diffs.filter(d => d.type === "SAME" || d.type === "MOVE");
		const new_diffs = diffs.filter(d => d.type === "NEW");
		expect(same_or_move.length).toBe(1);
		expect(new_diffs.length).toBe(1);
	});
});
