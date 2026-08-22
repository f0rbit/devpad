/**
 * Unit tests for the `tasks update <id>` CLI command's pure input-building
 * helper (src/task-update.ts). `build_task_update_input` decides which
 * fields the `devpad_tasks_upsert` MCP tool call receives (partial update)
 * and signals "no flags given" via a null return.
 */

import { describe, expect, test } from "bun:test";
import { build_task_update_input } from "../../src/task-update";

describe("build_task_update_input", () => {
	test("returns null when no fields are provided", () => {
		expect(build_task_update_input("task_1", {})).toBeNull();
	});

	test("maps status to the upstream progress enum", () => {
		expect(build_task_update_input("task_1", { status: "done" })).toEqual({
			id: "task_1",
			title: undefined,
			summary: undefined,
			priority: undefined,
			progress: "COMPLETED",
		});
		expect(build_task_update_input("task_1", { status: "in_progress" })?.progress).toBe("IN_PROGRESS");
		expect(build_task_update_input("task_1", { status: "todo" })?.progress).toBe("UNSTARTED");
	});

	test("uppercases priority", () => {
		expect(build_task_update_input("task_1", { priority: "high" })).toEqual({
			id: "task_1",
			title: undefined,
			summary: undefined,
			priority: "HIGH",
			progress: undefined,
		});
	});

	test("only sets the fields that were passed (partial update)", () => {
		const input = build_task_update_input("task_1", { title: "new title" });
		expect(input).toEqual({
			id: "task_1",
			title: "new title",
			summary: undefined,
			priority: undefined,
			progress: undefined,
		});
	});

	test("combines multiple flags", () => {
		const input = build_task_update_input("task_1", {
			title: "renamed",
			summary: "new summary",
			priority: "low",
			status: "in_progress",
		});
		expect(input).toEqual({
			id: "task_1",
			title: "renamed",
			summary: "new summary",
			priority: "LOW",
			progress: "IN_PROGRESS",
		});
	});

	test("returns undefined progress for an unrecognised status string", () => {
		expect(build_task_update_input("task_1", { status: "bogus" })?.progress).toBeUndefined();
	});
});
