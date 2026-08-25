import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@devpad/schema/database/types";
import type { Project, Task, TaskEvent, User } from "@devpad/schema";
import { emit_event } from "../../../graph/outbox.js";
import { upsert_hook } from "../../registry.js";
import {
	type ActionExecutor,
	type ActionResult,
	drain_pending_events,
	drain_stale_events,
	InMemoryDispatcher,
	process_task_event,
} from "../../dispatch.js";
import { hook_delivery } from "@devpad/schema/database/schema";
import { eq } from "drizzle-orm";
import { create_test_db, seed_project, seed_task, seed_user } from "./helpers.js";

const ENCRYPTION_KEY = "test-encryption-key";

class ScriptedExecutor implements ActionExecutor {
	public calls = 0;
	constructor(private readonly script: ActionResult[]) {}
	async execute(): Promise<ActionResult> {
		const result = this.script[Math.min(this.calls, this.script.length - 1)];
		this.calls += 1;
		return result ?? { ok: true };
	}
}

async function makeEvent(
	db: Database,
	project: Project,
	task: Task,
	overrides: Partial<Parameters<typeof emit_event>[1]> = {},
): Promise<TaskEvent> {
	const result = await emit_event(db, {
		kind: "task.completed",
		subject_id: task.id,
		project_id: project.id,
		actor: "user",
		payload: { kind: "task.completed", via: "user" },
		...overrides,
	});
	if (!result.ok) throw new Error(`Failed to emit event: ${JSON.stringify(result.error)}`);
	return result.value;
}

describe("hook dispatch (task A3.3)", () => {
	let db: Database;
	let owner: User;
	let project: Project;
	let task: Task;

	beforeEach(async () => {
		db = create_test_db();
		owner = await seed_user(db);
		project = await seed_project(db, owner.id);
		task = await seed_task(db, owner.id, { project_id: project.id, kind: "task" });
	});

	test("a matching event delivers exactly once, and replay via the same event_id is a no-op", async () => {
		const hook_result = await upsert_hook(db, ENCRYPTION_KEY, {
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		expect(hook_result.ok).toBe(true);

		const event = await makeEvent(db, project, task);
		const executor = new ScriptedExecutor([{ ok: true }]);

		const first = await process_task_event(db, { executor }, event.event_id);
		expect(first).toEqual({ ok: true, value: "ack" });
		expect(executor.calls).toBe(1);

		const deliveries = await db.select().from(hook_delivery).where(eq(hook_delivery.event_id, event.event_id));
		expect(deliveries.length).toBe(1);
		expect(deliveries[0]?.status).toBe("delivered");

		// Replay — same event_id, e.g. a redelivered queue message.
		const second = await process_task_event(db, { executor }, event.event_id);
		expect(second).toEqual({ ok: true, value: "ack" });
		expect(executor.calls).toBe(1); // executor NOT invoked again — terminal delivery short-circuits

		const deliveries_after_replay = await db
			.select()
			.from(hook_delivery)
			.where(eq(hook_delivery.event_id, event.event_id));
		expect(deliveries_after_replay.length).toBe(1);
	});

	test("a transient failure marks failed_transient with attempts=1, then a later pass delivers", async () => {
		await upsert_hook(db, ENCRYPTION_KEY, {
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		const event = await makeEvent(db, project, task);
		const executor = new ScriptedExecutor([{ ok: false, transient: true, message: "upstream 503" }, { ok: true }]);

		const first = await process_task_event(db, { executor }, event.event_id);
		expect(first).toEqual({ ok: true, value: "retry" });
		const after_first = await db.select().from(hook_delivery).where(eq(hook_delivery.event_id, event.event_id));
		expect(after_first[0]?.status).toBe("failed_transient");
		expect(after_first[0]?.attempts).toBe(1);

		const second = await process_task_event(db, { executor }, event.event_id);
		expect(second).toEqual({ ok: true, value: "ack" });
		const after_second = await db.select().from(hook_delivery).where(eq(hook_delivery.event_id, event.event_id));
		expect(after_second[0]?.status).toBe("delivered");
		expect(after_second[0]?.attempts).toBe(2);
	});

	test("a permanent failure lands failed_permanent immediately", async () => {
		await upsert_hook(db, ENCRYPTION_KEY, {
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: {} },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		const event = await makeEvent(db, project, task);
		const executor = new ScriptedExecutor([{ ok: false, transient: false, message: "bad config" }]);

		const result = await process_task_event(db, { executor }, event.event_id);
		expect(result).toEqual({ ok: true, value: "ack" });
		const deliveries = await db.select().from(hook_delivery).where(eq(hook_delivery.event_id, event.event_id));
		expect(deliveries[0]?.status).toBe("failed_permanent");
		expect(deliveries[0]?.last_error).toBe("bad config");
	});

	test("a non-matching selector skips the hook entirely (no delivery row)", async () => {
		await upsert_hook(db, ENCRYPTION_KEY, {
			project_id: project.id,
			enabled: true,
			trigger: { kinds: ["task.completed"], selector: { subject_kind: "phase" } },
			action: { kind: "pipeline", package_id: "anthropic-search" },
		});
		const event = await makeEvent(db, project, task); // task.kind === "task", selector wants "phase"
		const executor = new ScriptedExecutor([{ ok: true }]);

		const result = await process_task_event(db, { executor }, event.event_id);
		expect(result).toEqual({ ok: true, value: "ack" });
		expect(executor.calls).toBe(0);
		const deliveries = await db.select().from(hook_delivery).where(eq(hook_delivery.event_id, event.event_id));
		expect(deliveries.length).toBe(0);
	});

	test("pulse mirror no-ops without a configured client, and calls .event() when one is provided", async () => {
		const event = await makeEvent(db, project, task);
		const executor = new ScriptedExecutor([{ ok: true }]);

		// No pulse configured — must not throw.
		const without_pulse = await process_task_event(db, { executor }, event.event_id);
		expect(without_pulse.ok).toBe(true);

		const emitted: Array<{ name: string; properties?: Record<string, unknown> }> = [];
		let flushed = false;
		const event2 = await makeEvent(db, project, task);
		const with_pulse = await process_task_event(
			db,
			{
				executor,
				pulse: {
					event: (name, properties) => emitted.push({ name, properties }),
					flush: async () => {
						flushed = true;
					},
				},
			},
			event2.event_id,
		);
		expect(with_pulse.ok).toBe(true);
		expect(emitted.length).toBe(1);
		expect(emitted[0]?.name).toBe("task_event");
		expect(flushed).toBe(true);
	});

	test("drain_pending_events hands every pending row to the dispatcher and marks it dispatched", async () => {
		const event_a = await makeEvent(db, project, task);
		const event_b = await makeEvent(db, project, task);

		const dispatcher = new InMemoryDispatcher(async () => {
			// no-op consumer — this test only asserts producer-side behaviour
		});
		const result = await drain_pending_events(db, dispatcher);
		expect(result).toEqual({ ok: true, value: 2 });
		expect(dispatcher.sent.map((m) => m.event_id).toSorted()).toEqual([event_a.event_id, event_b.event_id].toSorted());

		const rows = await db.select().from(hook_delivery); // no hooks registered — table stays empty, just sanity
		expect(rows.length).toBe(0);
	});

	test("drain_stale_events only re-enqueues rows older than the staleness window", async () => {
		const fresh_event = await makeEvent(db, project, task);
		const stale_event = await makeEvent(db, project, task);

		// Back-date the stale row well past any staleness window.
		const { task_event } = await import("@devpad/schema/database/schema");
		await db
			.update(task_event)
			.set({ occurred_at: "2000-01-01 00:00:00" })
			.where(eq(task_event.event_id, stale_event.event_id));

		const dispatcher = new InMemoryDispatcher(async () => {});
		const result = await drain_stale_events(db, dispatcher, 60_000);
		expect(result).toEqual({ ok: true, value: 1 });
		expect(dispatcher.sent.map((m) => m.event_id)).toEqual([stale_event.event_id]);
		expect(dispatcher.sent.map((m) => m.event_id)).not.toContain(fresh_event.event_id);
	});
});
