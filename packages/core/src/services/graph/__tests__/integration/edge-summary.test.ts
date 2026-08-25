import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { upsert_hook } from "../../../hooks/registry.js";
import { edge_summary_for } from "../../edge-summary.js";
import { add_link } from "../../graph.js";
import { create_test_db, seed_project, seed_task, seed_user } from "./helpers.js";

const ENCRYPTION_KEY = "test-encryption-key";

let db: Database;
let owner_id: string;
let project_id: string;

beforeEach(async () => {
	db = create_test_db();
	owner_id = (await seed_user(db)).id;
	project_id = (await seed_project(db, owner_id)).id;
});

describe("edge_summary_for — blocked_count", () => {
	test("counts only alive, not-yet-completed blockers", async () => {
		const target = await seed_task(db, owner_id, { project_id });
		const open_blocker = await seed_task(db, owner_id, { project_id });
		const done_blocker = await seed_task(db, owner_id, { project_id, progress: "COMPLETED" });
		await add_link(db, { src_id: open_blocker.id, dst_id: target.id, kind: "blocks" });
		await add_link(db, { src_id: done_blocker.id, dst_id: target.id, kind: "blocks" });

		const result = await edge_summary_for(db, [target.id]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[target.id]?.blocked_count).toBe(1);
	});

	test("empty input returns an empty map without querying", async () => {
		const result = await edge_summary_for(db, []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual({});
	});
});

describe("edge_summary_for — ready", () => {
	test("an unblocked, childless, not-completed task is ready", async () => {
		const leaf = await seed_task(db, owner_id, { project_id, progress: "UNSTARTED" });
		const result = await edge_summary_for(db, [leaf.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[leaf.id]?.ready).toBe(true);
	});

	test("a task with an incomplete child is not ready", async () => {
		const parent = await seed_task(db, owner_id, { project_id });
		await seed_task(db, owner_id, { project_id, parent_id: parent.id });
		const result = await edge_summary_for(db, [parent.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[parent.id]?.ready).toBe(false);
	});

	test("a blocked task is not ready", async () => {
		const target = await seed_task(db, owner_id, { project_id });
		const blocker = await seed_task(db, owner_id, { project_id });
		await add_link(db, { src_id: blocker.id, dst_id: target.id, kind: "blocks" });
		const result = await edge_summary_for(db, [target.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[target.id]?.ready).toBe(false);
	});

	test("a completed task is never ready", async () => {
		const done = await seed_task(db, owner_id, { project_id, progress: "COMPLETED" });
		const result = await edge_summary_for(db, [done.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[done.id]?.ready).toBe(false);
	});
});

describe("edge_summary_for — stale", () => {
	test("a policy-completed task with a fresh incomplete child is stale", async () => {
		const parent = await seed_task(db, owner_id, {
			project_id,
			completion_policy: "auto_children",
			progress: "COMPLETED",
			completed_via: "policy",
		});
		await seed_task(db, owner_id, { project_id, parent_id: parent.id });

		const result = await edge_summary_for(db, [parent.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[parent.id]?.stale).toBe(true);
	});

	test("a user-completed task with an incomplete child is not stale (sticky, but not policy-completed)", async () => {
		const parent = await seed_task(db, owner_id, { project_id, progress: "COMPLETED", completed_via: "user" });
		await seed_task(db, owner_id, { project_id, parent_id: parent.id });

		const result = await edge_summary_for(db, [parent.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[parent.id]?.stale).toBe(false);
	});
});

describe("edge_summary_for — hook", () => {
	test("a task whose kind matches an enabled task.completed hook's selector is flagged", async () => {
		await upsert_hook(db, ENCRYPTION_KEY, {
			project_id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: { subject_kind: "milestone" } },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		const milestone = await seed_task(db, owner_id, { project_id, kind: "milestone" });
		const plain_task = await seed_task(db, owner_id, { project_id, kind: "task" });

		const result = await edge_summary_for(db, [milestone.id, plain_task.id]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value[milestone.id]?.hook).toBe(true);
		expect(result.value[plain_task.id]?.hook).toBe(false);
	});

	test("a disabled hook never sets the flag", async () => {
		await upsert_hook(db, ENCRYPTION_KEY, {
			project_id,
			enabled: false,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		const target = await seed_task(db, owner_id, { project_id });
		const result = await edge_summary_for(db, [target.id]);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value[target.id]?.hook).toBe(false);
	});
});
