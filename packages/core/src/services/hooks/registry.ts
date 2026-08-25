/**
 * @module core/services/hooks/registry
 *
 * v2.4 (task A3.2) — CRUD for `hook` + read access to `hook_delivery`.
 * Webhook secrets are encrypted at rest (`ENCRYPTION_KEY`, the same helper
 * media credentials use) and NEVER leave this module in plaintext once
 * stored — every read path returns `PublicHook`, which redacts
 * `secret_encrypted` down to a `has_secret` boolean.
 */

import type { Hook, HookDelivery, HookDeliveryStatus, HookTrigger, UpsertHook } from "@devpad/schema";
import { hook_action_stored, hook_trigger, type HookActionPublic } from "@devpad/schema/validation";
import { hook, hook_delivery } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, desc, eq } from "drizzle-orm";
import type { ServiceError } from "../errors.js";
import { secrets } from "../media/utils.js";

export type PublicHook = Omit<Hook, "action" | "trigger"> & {
	trigger: HookTrigger;
	action: HookActionPublic;
};

function redact_action(raw: unknown): Result<HookActionPublic, ServiceError> {
	const parsed = hook_action_stored.safeParse(raw);
	if (!parsed.success) return err({ kind: "db_error", message: "hook.action failed to parse" });
	if (parsed.data.kind === "webhook") {
		return ok({ kind: "webhook", url: parsed.data.url, has_secret: Boolean(parsed.data.secret_encrypted) });
	}
	return ok(parsed.data);
}

function to_public_hook(row: Hook): Result<PublicHook, ServiceError> {
	const trigger_parsed = hook_trigger.safeParse(row.trigger);
	if (!trigger_parsed.success) return err({ kind: "db_error", message: "hook.trigger failed to parse" });
	const action_result = redact_action(row.action);
	if (!action_result.ok) return action_result;
	const { action: _action, trigger: _trigger, ...rest } = row;
	return ok({ ...rest, trigger: trigger_parsed.data, action: action_result.value });
}

export async function list_hooks(db: Database, project_id: string): Promise<Result<PublicHook[], ServiceError>> {
	const rows = await db
		.select()
		.from(hook)
		.where(and(eq(hook.project_id, project_id), eq(hook.deleted, false)));

	const public_hooks: PublicHook[] = [];
	for (const row of rows) {
		const mapped = to_public_hook(row);
		if (!mapped.ok) return mapped;
		public_hooks.push(mapped.value);
	}
	return ok(public_hooks);
}

/** Internal — used by the worker route (ownership/scope checks) and the dispatcher (needs the raw, still-encrypted action). */
export async function get_hook(db: Database, id: string): Promise<Result<Hook, ServiceError>> {
	const rows = await db
		.select()
		.from(hook)
		.where(and(eq(hook.id, id), eq(hook.deleted, false)));
	if (rows.length === 0) return err({ kind: "not_found", resource: "hook", id });
	return ok(rows[0]);
}

export async function upsert_hook(
	db: Database,
	encryption_key: string,
	input: UpsertHook,
): Promise<Result<PublicHook, ServiceError>> {
	let action: Record<string, unknown> = input.action;
	if (input.action.kind === "webhook" && input.action.secret) {
		const encrypted = await secrets.encrypt(input.action.secret, encryption_key);
		if (!encrypted.ok) return err({ kind: "encryption_error", operation: "encrypt", message: encrypted.error.message });
		action = { kind: "webhook", url: input.action.url, secret_encrypted: encrypted.value };
	} else if (input.action.kind === "webhook") {
		action = { kind: "webhook", url: input.action.url };
	}

	if (input.id) {
		const rows = await db
			.update(hook)
			.set({ enabled: input.enabled, trigger: input.trigger, action, updated_at: new Date().toISOString() })
			.where(and(eq(hook.id, input.id), eq(hook.project_id, input.project_id)))
			.returning();
		if (rows.length === 0) return err({ kind: "not_found", resource: "hook", id: input.id });
		return to_public_hook(rows[0]);
	}

	const rows = await db
		.insert(hook)
		.values({ project_id: input.project_id, enabled: input.enabled, trigger: input.trigger, action })
		.returning();
	return to_public_hook(rows[0]);
}

/**
 * v2.4 (B3.4) — the settings panel's enable/disable toggle. A single-column
 * update, deliberately NOT routed through `upsert_hook`: that path requires
 * the caller to resubmit `trigger`+`action` in full, and `PublicHook`'s
 * `action` never carries a webhook's `secret` back out (write-only, per this
 * module's own doc comment) — round-tripping it through `upsert_hook` would
 * silently drop `secret_encrypted` the moment a toggle-only caller omits it.
 */
export async function set_hook_enabled(
	db: Database,
	id: string,
	project_id: string,
	enabled: boolean,
): Promise<Result<PublicHook, ServiceError>> {
	const rows = await db
		.update(hook)
		.set({ enabled, updated_at: new Date().toISOString() })
		.where(and(eq(hook.id, id), eq(hook.project_id, project_id)))
		.returning();
	if (rows.length === 0) return err({ kind: "not_found", resource: "hook", id });
	return to_public_hook(rows[0]);
}

export async function delete_hook(db: Database, id: string): Promise<Result<void, ServiceError>> {
	const rows = await db.update(hook).set({ deleted: true }).where(eq(hook.id, id)).returning();
	if (rows.length === 0) return err({ kind: "not_found", resource: "hook", id });
	return ok(undefined);
}

export async function list_deliveries(
	db: Database,
	hook_id: string,
	status?: HookDeliveryStatus,
): Promise<Result<HookDelivery[], ServiceError>> {
	const conditions = [eq(hook_delivery.hook_id, hook_id)];
	if (status) conditions.push(eq(hook_delivery.status, status));
	const rows = await db
		.select()
		.from(hook_delivery)
		.where(and(...conditions))
		.orderBy(desc(hook_delivery.created_at));
	return ok(rows);
}
