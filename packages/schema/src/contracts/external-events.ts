/**
 * chamber CI → devpad orchestrator: `POST /runs/:id/events`.
 *
 * The body reuses the route schema `webhook_event_body` from
 * `@devpad/schema/validation` (single source of truth for
 * `stage_name`/`kind`/`idempotency_key`) and narrows `payload`: the
 * orchestrator's DO refuses to advance a run whose event payload does
 * not carry a `sha` (`apply_external_event` → `external_event_sha_of`,
 * the #155 strand-the-run-in-`deploying` incident), so `payload.sha` is
 * REQUIRED at the contract level even though the route schema keeps
 * `payload` free-form.
 *
 * The response surfaces `tick` — the AWAITED outcome of the DO
 * `/external-event` call — so CI logs can tell whether the run actually
 * advanced (`applied` / `noop:<reason>` / `failed:<message>` /
 * `skipped:*`).
 */
import { z } from "zod";
import { webhook_event_body } from "../validation.js";
import { wire_error } from "./wire.js";

export const external_event_payload = z.object({ sha: z.string().min(1) }).passthrough();

export const external_event_request = z.object({
	...webhook_event_body.shape,
	payload: external_event_payload,
});

export type ExternalEventRequest = z.infer<typeof external_event_request>;

const noop_tick = z.string().regex(/^noop:[a-z_]+$/);
const failed_tick = z.string().regex(/^failed:.+/);

export const ingest_tick = z.union([
	z.literal("applied"),
	noop_tick,
	failed_tick,
	z.literal("skipped:informational"),
	z.literal("skipped:duplicated"),
]);

export type IngestTick = z.infer<typeof ingest_tick>;

export const external_event_response = z.object({
	ok: z.literal(true),
	value: z.object({
		event_id: z.string().min(1),
		duplicated: z.boolean(),
		tick: ingest_tick,
	}),
});

export const external_event_error = wire_error;
