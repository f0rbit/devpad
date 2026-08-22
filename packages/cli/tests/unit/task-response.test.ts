/**
 * Unit tests for src/task-response.ts — the boundary parser that catches the
 * "ID: undefined" papercut: `devpad_tasks_upsert` resolves to a
 * `TaskWithDetails` (`{ task, codebase_tasks, tags }`), not a flat task row.
 */

import { describe, expect, test } from "bun:test";
import { parse_task_response } from "../../src/task-response";

describe("parse_task_response", () => {
	test("extracts the nested task from a TaskWithDetails response", () => {
		const response = {
			task: { id: "task_1", title: "write tests", progress: "UNSTARTED" },
			codebase_tasks: null,
			tags: [],
		};

		expect(parse_task_response(response).task).toEqual(response.task);
	});

	test("throws a clear error when the response is flat instead of nested", () => {
		const flat_response = { id: "task_1", title: "write tests" };

		expect(() => parse_task_response(flat_response)).toThrow(/Unexpected task response shape/);
	});

	test("throws when task.id or task.title is missing", () => {
		expect(() => parse_task_response({ task: { title: "no id" } })).toThrow();
		expect(() => parse_task_response({ task: { id: "task_1" } })).toThrow();
	});
});
