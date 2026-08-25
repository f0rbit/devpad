import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import { github_webhook_event, hook_delivery, task_event } from "@devpad/schema/database/schema";
import { upsert_hook } from "../../registry.js";
import { sweep_retention } from "../../retention.js";
import { create_test_db, seed_project, seed_task, seed_user } from "./helpers.js";

const ENCRYPTION_KEY = "test-encryption-key";
const DAY_MS = 24 * 60 * 60 * 1000;

function sqliteTimestamp(ms_ago: number): string {
	return new Date(Date.now() - ms_ago).toISOString().slice(0, 19).replace("T", " ");
}

describe("hook retention sweep (task A3.7)", () => {
	let db: Database;

	beforeEach(async () => {
		db = create_test_db();
	});

	test("prunes dispatched task_event rows older than 30 days, leaves recent ones", async () => {
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		const task = await seed_task(db, owner.id, { project_id: project.id });

		await db.insert(task_event).values([
			{
				event_id: "evt_old",
				kind: "task.completed",
				subject_id: task.id,
				project_id: project.id,
				actor: "user",
				payload: { kind: "task.completed", via: "user" },
				dispatch_status: "dispatched",
				occurred_at: sqliteTimestamp(31 * DAY_MS),
			},
			{
				event_id: "evt_recent",
				kind: "task.completed",
				subject_id: task.id,
				project_id: project.id,
				actor: "user",
				payload: { kind: "task.completed", via: "user" },
				dispatch_status: "dispatched",
				occurred_at: sqliteTimestamp(1 * DAY_MS),
			},
			{
				event_id: "evt_old_pending",
				kind: "task.completed",
				subject_id: task.id,
				project_id: project.id,
				actor: "user",
				payload: { kind: "task.completed", via: "user" },
				dispatch_status: "pending",
				occurred_at: sqliteTimestamp(31 * DAY_MS),
			},
		]);

		const result = await sweep_retention(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.task_events_pruned).toBe(1);

		const remaining = await db.select({ event_id: task_event.event_id }).from(task_event);
		const remaining_ids = remaining.map((r) => r.event_id).toSorted();
		expect(remaining_ids).toEqual(["evt_old_pending", "evt_recent"]); // pending survives regardless of age
	});

	test("prunes delivered hook_delivery rows older than 90 days, NEVER prunes failed_permanent", async () => {
		const owner = await seed_user(db);
		const project = await seed_project(db, owner.id);
		const hook_result = await upsert_hook(db, ENCRYPTION_KEY, {
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(hook_result.ok).toBe(true);
		if (!hook_result.ok) return;
		const hook_id = hook_result.value.id;

		await db.insert(hook_delivery).values([
			{
				id: "hdl_old_delivered",
				hook_id,
				event_id: "evt_1",
				status: "delivered",
				updated_at: sqliteTimestamp(91 * DAY_MS),
			},
			{
				id: "hdl_recent_delivered",
				hook_id,
				event_id: "evt_2",
				status: "delivered",
				updated_at: sqliteTimestamp(1 * DAY_MS),
			},
			{
				id: "hdl_old_failed_permanent",
				hook_id,
				event_id: "evt_3",
				status: "failed_permanent",
				last_error: "boom",
				updated_at: sqliteTimestamp(365 * DAY_MS),
			},
		]);

		const result = await sweep_retention(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.hook_deliveries_pruned).toBe(1);

		const remaining = await db.select({ id: hook_delivery.id }).from(hook_delivery);
		const remaining_ids = remaining.map((r) => r.id).toSorted();
		expect(remaining_ids).toEqual(["hdl_old_failed_permanent", "hdl_recent_delivered"]);
	});

	test("prunes github_webhook_event rows older than 30 days", async () => {
		await db.insert(github_webhook_event).values([
			{ id: "gh_old", delivery_guid: "guid_1", event_type: "pull_request", processed_at: sqliteTimestamp(31 * DAY_MS) },
			{
				id: "gh_recent",
				delivery_guid: "guid_2",
				event_type: "pull_request",
				processed_at: sqliteTimestamp(1 * DAY_MS),
			},
		]);

		const result = await sweep_retention(db);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.github_webhook_events_pruned).toBe(1);

		const remaining = await db.select({ id: github_webhook_event.id }).from(github_webhook_event);
		expect(remaining.map((r) => r.id)).toEqual(["gh_recent"]);
	});

	test("respects the batch bound", async () => {
		const rows = Array.from({ length: 5 }, (_, i) => ({
			id: `gh_batch_${String(i)}`,
			delivery_guid: `guid_batch_${String(i)}`,
			event_type: "pull_request",
			processed_at: sqliteTimestamp(31 * DAY_MS),
		}));
		await db.insert(github_webhook_event).values(rows);

		const result = await sweep_retention(db, 2);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.github_webhook_events_pruned).toBe(2);

		const remaining = await db.select({ id: github_webhook_event.id }).from(github_webhook_event);
		expect(remaining.length).toBe(3);
	});
});
