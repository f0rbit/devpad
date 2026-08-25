/**
 * @module core/services/hooks/dispatch
 *
 * v2.4 (task A3.3) — the automation spine's producer + consumer.
 *
 * Producer (`drain_pending_events`/`drain_stale_events`): scans `task_event`
 * rows with `dispatch_status='pending'` and hands each `event_id` to a
 * `DispatchProvider` — either the real Cloudflare Queue (`CFQueueProvider`)
 * or, in dev/tests, `InMemoryDispatcher` which runs the consumer
 * synchronously. Marking a row `dispatched` only means "handed to the
 * queue", not "hooks processed" — that reliability lives in `hook_delivery`.
 *
 * Consumer (`process_task_event`): (a) mirrors the event to pulse
 * (no-op without a configured client — preview stays read-only), (b) finds
 * enabled hooks whose trigger matches the event's kind + selector, (c) for
 * each match, idempotently inserts a `hook_delivery` row keyed by
 * `hook_delivery_id(event_id, hook_id)` and executes the hook's action via
 * the injected `ActionExecutor` seam (concrete executors land in A3.4).
 *
 * A delivery already in a terminal state (`delivered`/`failed_permanent`) is
 * a no-op on replay — this is what makes redelivering the same queue
 * message twice safe.
 */

import type { Hook, TaskEvent } from "@devpad/schema";
import { hook, hook_delivery, task_event } from "@devpad/schema/database/schema";
import { hook_action_stored, hook_trigger, type HookActionStored, type HookTrigger } from "@devpad/schema/validation";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, asc, eq, lt } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { ancestors } from "../graph/graph.js";
import { sqlite_utc_cutoff } from "../graph/sweeper.js";
import { getTask } from "../tasks.js";

export type DispatchMessage = { event_id: string };

export type DispatchProvider = {
	send(message: DispatchMessage): Promise<void>;
};

/** Structural subset of Cloudflare's `Queue<T>` — avoids a `@cloudflare/workers-types` dependency in `@devpad/core` just for this one method shape. */
export type QueueLike<T> = { send(message: T, options?: unknown): Promise<unknown> };

/** Production seam — wraps the `HOOKS_QUEUE` Cloudflare Queue binding. */
export class CFQueueProvider implements DispatchProvider {
	constructor(private readonly queue: QueueLike<DispatchMessage>) {}

	async send(message: DispatchMessage): Promise<void> {
		await this.queue.send(message);
	}
}

/** Dev/test seam — runs the consumer synchronously so no real queue infra is needed. */
export class InMemoryDispatcher implements DispatchProvider {
	public readonly sent: DispatchMessage[] = [];

	constructor(private readonly consume: (message: DispatchMessage) => Promise<void>) {}

	async send(message: DispatchMessage): Promise<void> {
		this.sent.push(message);
		await this.consume(message);
	}
}

const DRAIN_BATCH_LIMIT = 50;

async function drain(
	db: Database,
	dispatch: DispatchProvider,
	limit: number,
	stale_cutoff?: string,
): Promise<Result<number, ServiceError>> {
	const conditions = stale_cutoff
		? and(eq(task_event.dispatch_status, "pending"), lt(task_event.occurred_at, stale_cutoff))
		: eq(task_event.dispatch_status, "pending");

	const rows = await db
		.select({ id: task_event.id, event_id: task_event.event_id })
		.from(task_event)
		.where(conditions)
		.orderBy(asc(task_event.id))
		.limit(limit);

	for (const row of rows) {
		await dispatch.send({ event_id: row.event_id });
		await db
			.update(task_event)
			.set({ dispatch_status: "dispatched", dispatched_at: new Date().toISOString() })
			.where(eq(task_event.id, row.id));
	}
	return ok(rows.length);
}

/** Post-commit `waitUntil` producer — drains everything currently pending. */
export async function drain_pending_events(
	db: Database,
	dispatch: DispatchProvider,
	limit = DRAIN_BATCH_LIMIT,
): Promise<Result<number, ServiceError>> {
	return drain(db, dispatch, limit);
}

/**
 * Cron backstop (task A3.3) — re-enqueues rows stuck `pending` for at least
 * `stale_after_ms`. Exists for the case a `waitUntil` died before draining;
 * the staleness window avoids racing a concurrent request's own drain (a
 * duplicate enqueue is harmless — `hook_delivery`'s PK absorbs it).
 */
export async function drain_stale_events(
	db: Database,
	dispatch: DispatchProvider,
	stale_after_ms = 60_000,
	limit = DRAIN_BATCH_LIMIT,
): Promise<Result<number, ServiceError>> {
	return drain(db, dispatch, limit, sqlite_utc_cutoff(stale_after_ms));
}

export async function hook_delivery_id(event_id: string, hook_id: string): Promise<string> {
	const bytes = new TextEncoder().encode(`${event_id}:${hook_id}`);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
	return `hdl_${hex}`;
}

export type PulseMirror = {
	event(name: string, properties?: Record<string, unknown>): void;
	flush(): Promise<void>;
};

/** No-op without a configured pulse client — this is exactly what keeps preview read-only against production pulse. */
export async function mirror_to_pulse(pulse: PulseMirror | undefined, event: TaskEvent): Promise<void> {
	if (!pulse) return;
	pulse.event("task_event", {
		kind: event.kind,
		subject_id: event.subject_id,
		project_id: event.project_id,
		actor: event.actor,
	});
	await pulse.flush();
}

export type ActionResult = { ok: true } | { ok: false; transient: boolean; message: string };

export type ActionExecutor = {
	execute(input: {
		action: HookActionStored;
		event: TaskEvent;
		hook: Hook;
		delivery_id: string;
	}): Promise<ActionResult>;
};

/** Executor placeholder for dispatcher-only tests — real executors (webhook/vault/pipeline) land in task A3.4. */
export const NoopActionExecutor: ActionExecutor = {
	async execute() {
		return { ok: true };
	},
};

/** A transient failure this many times over is treated as permanent — decouples the DLQ decision from the underlying queue's own retry/backoff config. */
const HOOK_ACTION_MAX_TRANSIENT_ATTEMPTS = 5;

async function matches_selector(
	db: Database,
	event: TaskEvent,
	selector: HookTrigger["selector"],
): Promise<Result<boolean, ServiceError>> {
	if (!selector.subject_kind && !selector.tag && !selector.ancestor_id) return ok(true);

	const subject = await getTask(db, event.subject_id);
	if (!subject.ok) return subject;
	if (!subject.value) return ok(false);

	if (selector.subject_kind && subject.value.task.kind !== selector.subject_kind) return ok(false);
	if (selector.tag && !subject.value.tags.includes(selector.tag)) return ok(false);

	if (selector.ancestor_id) {
		const ancestor_rows = await ancestors(db, event.subject_id);
		if (!ancestor_rows.ok) return ancestor_rows;
		if (!ancestor_rows.value.some((a) => a.id === selector.ancestor_id)) return ok(false);
	}

	return ok(true);
}

async function matching_hooks(db: Database, event: TaskEvent): Promise<Result<Hook[], ServiceError>> {
	if (!event.project_id) return ok([]);

	const rows = await db
		.select()
		.from(hook)
		.where(and(eq(hook.project_id, event.project_id), eq(hook.enabled, true), eq(hook.deleted, false)));

	const matched: Hook[] = [];
	for (const row of rows) {
		const trigger_parsed = hook_trigger.safeParse(row.trigger);
		if (!trigger_parsed.success) continue;
		if (!trigger_parsed.data.kinds.includes(event.kind)) continue;

		const selector_result = await matches_selector(db, event, trigger_parsed.data.selector);
		if (!selector_result.ok) return selector_result;
		if (selector_result.value) matched.push(row);
	}
	return ok(matched);
}

async function deliver_one(
	db: Database,
	executor: ActionExecutor,
	event: TaskEvent,
	matched_hook: Hook,
): Promise<Result<"ack" | "retry", ServiceError>> {
	const delivery_id = await hook_delivery_id(event.event_id, matched_hook.id);

	await db
		.insert(hook_delivery)
		.values({ id: delivery_id, hook_id: matched_hook.id, event_id: event.event_id, status: "pending" })
		.onConflictDoNothing();

	const existing = await db.select().from(hook_delivery).where(eq(hook_delivery.id, delivery_id));
	if (existing.length === 0) return err({ kind: "db_error", message: "hook_delivery row missing after insert" });
	const delivery_row = existing[0];
	if (delivery_row.status === "delivered" || delivery_row.status === "failed_permanent") return ok("ack");

	const action_parsed = hook_action_stored.safeParse(matched_hook.action);
	const now = new Date().toISOString();
	if (!action_parsed.success) {
		await db
			.update(hook_delivery)
			.set({
				status: "failed_permanent",
				attempts: delivery_row.attempts + 1,
				last_error: "hook.action failed to parse",
				updated_at: now,
			})
			.where(eq(hook_delivery.id, delivery_id));
		return ok("ack");
	}

	const result = await executor.execute({ action: action_parsed.data, event, hook: matched_hook, delivery_id });
	const attempts = delivery_row.attempts + 1;

	if (result.ok) {
		await db
			.update(hook_delivery)
			.set({ status: "delivered", attempts, updated_at: now })
			.where(eq(hook_delivery.id, delivery_id));
		return ok("ack");
	}

	const permanent = !result.transient || attempts >= HOOK_ACTION_MAX_TRANSIENT_ATTEMPTS;
	await db
		.update(hook_delivery)
		.set({
			status: permanent ? "failed_permanent" : "failed_transient",
			attempts,
			last_error: result.message,
			updated_at: now,
		})
		.where(eq(hook_delivery.id, delivery_id));
	return ok(permanent ? "ack" : "retry");
}

export type ProcessOutcome = "ack" | "retry";

/** The consumer body — `CFQueueProvider`'s queue handler calls this per message and maps the outcome to `msg.ack()`/`msg.retry()`. */
export async function process_task_event(
	db: Database,
	deps: { pulse?: PulseMirror; executor: ActionExecutor },
	event_id: string,
): Promise<Result<ProcessOutcome, ServiceError>> {
	const event_rows = await db.select().from(task_event).where(eq(task_event.event_id, event_id));
	if (event_rows.length === 0) return err({ kind: "not_found", resource: "task_event", id: event_id });
	const event = event_rows[0];

	await mirror_to_pulse(deps.pulse, event);

	const matched = await matching_hooks(db, event);
	if (!matched.ok) return matched;

	let needs_retry = false;
	for (const matched_hook of matched.value) {
		const outcome = await deliver_one(db, deps.executor, event, matched_hook);
		if (!outcome.ok) return outcome;
		if (outcome.value === "retry") needs_retry = true;
	}
	return ok(needs_retry ? "retry" : "ack");
}
