/**
 * @module core/services/hooks/retention
 *
 * v2.4 (task A3.7) — the automation spine's event log must not become
 * context poison (the beads lesson). Retention windows are single-source
 * constants; the cron sweep applies them in bounded batches.
 *
 * `failed_permanent` `hook_delivery` rows are NEVER auto-deleted — that's
 * the visible DLQ. Only `delivered` rows age out.
 */

import { github_webhook_event, hook_delivery, task_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { and, eq, inArray, lt } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { sqlite_utc_cutoff } from "../graph/sweeper.js";

export const RETENTION_WINDOWS_MS = {
	dispatched_task_event: 30 * 24 * 60 * 60 * 1000,
	delivered_hook_delivery: 90 * 24 * 60 * 60 * 1000,
	github_webhook_event: 30 * 24 * 60 * 60 * 1000,
} as const;

const RETENTION_BATCH_LIMIT = 500;

export type RetentionReport = {
	task_events_pruned: number;
	hook_deliveries_pruned: number;
	github_webhook_events_pruned: number;
};

async function prune_dispatched_task_events(db: Database, limit: number): Promise<number> {
	const cutoff = sqlite_utc_cutoff(RETENTION_WINDOWS_MS.dispatched_task_event);
	const stale = await db
		.select({ id: task_event.id })
		.from(task_event)
		.where(and(eq(task_event.dispatch_status, "dispatched"), lt(task_event.occurred_at, cutoff)))
		.limit(limit);
	if (stale.length === 0) return 0;
	await db.delete(task_event).where(
		inArray(
			task_event.id,
			stale.map((r) => r.id),
		),
	);
	return stale.length;
}

async function prune_delivered_hook_deliveries(db: Database, limit: number): Promise<number> {
	const cutoff = sqlite_utc_cutoff(RETENTION_WINDOWS_MS.delivered_hook_delivery);
	const stale = await db
		.select({ id: hook_delivery.id })
		.from(hook_delivery)
		.where(and(eq(hook_delivery.status, "delivered"), lt(hook_delivery.updated_at, cutoff)))
		.limit(limit);
	if (stale.length === 0) return 0;
	await db.delete(hook_delivery).where(
		inArray(
			hook_delivery.id,
			stale.map((r) => r.id),
		),
	);
	return stale.length;
}

async function prune_github_webhook_events(db: Database, limit: number): Promise<number> {
	const cutoff = sqlite_utc_cutoff(RETENTION_WINDOWS_MS.github_webhook_event);
	const stale = await db
		.select({ id: github_webhook_event.id })
		.from(github_webhook_event)
		.where(lt(github_webhook_event.processed_at, cutoff))
		.limit(limit);
	if (stale.length === 0) return 0;
	await db.delete(github_webhook_event).where(
		inArray(
			github_webhook_event.id,
			stale.map((r) => r.id),
		),
	);
	return stale.length;
}

export async function sweep_retention(
	db: Database,
	batch_limit = RETENTION_BATCH_LIMIT,
): Promise<Result<RetentionReport, ServiceError>> {
	const task_events_pruned = await prune_dispatched_task_events(db, batch_limit);
	const hook_deliveries_pruned = await prune_delivered_hook_deliveries(db, batch_limit);
	const github_webhook_events_pruned = await prune_github_webhook_events(db, batch_limit);
	return ok({ task_events_pruned, hook_deliveries_pruned, github_webhook_events_pruned });
}
