import { describe, expect, test } from "bun:test";
import { external_ref, upsert_todo } from "@devpad/schema/validation";

describe("external_ref", () => {
	test("accepts each documented discriminant", () => {
		const refs: unknown[] = [
			{ type: "pr", url: "https://github.com/f0rbit/devpad/pull/1" },
			{ type: "commit", sha: "abc123" },
			{ type: "file", path: "packages/core/src/index.ts" },
			{ type: "doc", doc_id: "doc_1" },
			{ type: "metric", name: "error_rate" },
			{ type: "pipeline_run", run_id: "pipeline-run_1" },
		];
		for (const ref of refs) {
			const parsed = external_ref.safeParse(ref);
			expect(parsed.success).toBe(true);
		}
	});

	test("rejects an unknown discriminant", () => {
		const parsed = external_ref.safeParse({ type: "unknown_kind", value: "x" });
		expect(parsed.success).toBe(false);
	});
});

describe("upsert_todo graph fields", () => {
	const base = { owner_id: "user_1", title: "test task" };

	test("accepts and round-trips parent_id, rank, kind, completion_policy", () => {
		const input = {
			...base,
			parent_id: "task_parent",
			rank: "i0",
			kind: "phase" as const,
			completion_policy: "auto_children" as const,
		};
		const parsed = upsert_todo.parse(input);
		expect(parsed.parent_id).toBe("task_parent");
		expect(parsed.rank).toBe("i0");
		expect(parsed.kind).toBe("phase");
		expect(parsed.completion_policy).toBe("auto_children");
	});

	test("rejects an invalid kind literal", () => {
		const parsed = upsert_todo.safeParse({ ...base, kind: "milestone" });
		expect(parsed.success).toBe(false);
	});

	test("completed_via is not part of the input schema — it is stripped, never accepted", () => {
		const parsed = upsert_todo.parse({ ...base, completed_via: "policy" });
		expect(parsed).not.toHaveProperty("completed_via");
	});
});
