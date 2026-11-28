/**
 * @module core/services/pipelines/events
 *
 * Webhook event ingestion for in-flight pipeline runs (Phase 2.C).
 * Side-effect-bearing — same shape as the rest of the pipeline service
 * layer (deps record, Result<T, E> return).
 *
 * Surface:
 *
 * - `ingest_event(deps, input)` — idempotently insert a row into
 *   `pipeline_stage_event`, fire-and-forget a pulse signal, and — iff the
 *   kind is state-transition-relevant — AWAIT the run's Durable Object
 *   tick and return its outcome in `tick`.
 *
 * Idempotency: per `(run_id, idempotency_key, payload)` triple. We hash
 * the key + JSON-serialised payload into a content-addressed
 * `idempotency_hash` column; replay with the same triple returns the
 * existing row, replay with a different payload (same key) returns a
 * typed `validation_error` so the caller knows their key is being
 * reused for diverging content.
 *
 * The DO tick is skipped for informational events (warning, error,
 * deploy_started, bake_*) — those exist for observability only.
 */

import type { PipelineStageEvent, StageEventKind } from "@devpad/schema";
import { pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createLogger } from "../../utils/logger.js";
import type { ServiceError } from "../errors.js";
import { is_record } from "./is-record.js";
import { parse_run_row } from "./row-parse.js";

const logger = createLogger("pipelines.events");

// ─── Types ──────────────────────────────────────────────────────────

export type EventValidationError = {
	kind: "validation_error";
	field: "idempotency_key";
	message: string;
};

export type IngestEventInput = {
	run_id: string;
	package_id: string;
	stage_name: string;
	kind: StageEventKind;
	payload?: unknown;
	idempotency_key: string;
};

export type IngestEventOutput = {
	event_id: string;
	duplicated: boolean;
	/**
	 * Outcome of the awaited DO tick (transition kinds only). Surfaced so
	 * CI logs can tell whether the run actually advanced: `applied` (state
	 * machine moved), `noop:<reason>` (DO refused — sha/stage mismatch,
	 * orchestrated run, malformed payload), `failed:<message>` (tick
	 * request itself broke — the event row is still durable), or
	 * `skipped:*` (no tick attempted: informational kind, or idempotent
	 * replay whose original insert already completed its tick).
	 */
	tick: IngestTick;
};

/**
 * Tick outcome string returned in {@link IngestEventOutput.tick}. The
 * `noop:` variant carries the DO's `ExternalEventNoOp` reason
 * (`orchestrated_run` | `malformed_payload` | `sha_mismatch` |
 * `stage_mismatch`); `failed:` carries the error message.
 */
export type IngestTick =
	| "applied"
	| `noop:${string}`
	| `failed:${string}`
	| "skipped:informational"
	| "skipped:duplicated";

/**
 * Minimal Durable Object namespace surface the service relies on for
 * its tick. Mirrors {@link DoRouter} in `packages/pipelines/src/do-router.ts`
 * but defined locally so the core service has no dependency on the
 * orchestrator Worker package.
 */
export type EventDoRouter = {
	fetch(run_id: string, path: string, body: unknown): Promise<Response>;
};

/**
 * Pulse emitter accepting arbitrary `{ event, ... }` payloads —
 * fire-and-forget, so the return type intentionally loose.
 */
export type EventPulseEmitter = {
	emit(event: { event: string } & Record<string, unknown>): Promise<unknown>;
};

export type EventDeps = {
	db: Database;
	pulse: EventPulseEmitter;
	do: EventDoRouter;
};

// ─── Constants ──────────────────────────────────────────────────────

/**
 * State-transition-relevant event kinds. Only these tick the DO; all
 * other kinds are informational (deploy_started, bake_*, warning, error,
 * approval_requested) and don't advance the run's state machine.
 */
const TRANSITION_KINDS: ReadonlySet<StageEventKind> = new Set<StageEventKind>([
	"deploy_completed",
	"deploy_failed",
	"gate_verdict",
	"rollback_completed",
]);

const make_event_id = (): string => `pipeline-stage-event_${crypto.randomUUID()}`;

// ─── Hash helper ────────────────────────────────────────────────────

/**
 * SHA-256(idempotency_key + ":" + JSON(payload ?? null)) → hex.
 * Web Crypto `subtle.digest` is available in Workers, bun, and the test
 * runtime — no node:crypto dependency needed.
 */
const idempotency_hash = async (idempotency_key: string, payload: unknown): Promise<string> => {
	const input = `${idempotency_key}:${JSON.stringify(payload ?? null)}`;
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const view = new Uint8Array(digest);
	return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// ─── ingest_event ───────────────────────────────────────────────────

/**
 * Idempotently record a webhook event against a run. Caller scope check
 * (`run.package_id === input.package_id`) lives here so the route layer
 * can rely on the service for the load-bearing authorization check; the
 * route still validates session scope (`runs:events`) before delegating.
 *
 * Five-step flow:
 *
 *  1. Load `pipeline_run` by id — 404 if missing, 403 if package mismatch.
 *  2. Hash the idempotency_key + payload to a deterministic key.
 *  3. Same-key-different-content collisions surface via the key-collision
 *     scan as a typed `validation_error` so the caller knows their key is
 *     being reused for diverging content.
 *  4. Insert the new row, stamping `payload.source = "external"`
 *     server-side (input-supplied source is overwritten). Idempotent
 *     replay is enforced by the partial unique index on
 *     `(run_id, idempotency_hash)` — a replay resolves as a constraint
 *     violation and returns the existing row with `duplicated: true`.
 *  5. Fire-and-forget pulse emit; AWAIT the DO tick (via
 *     `/external-event`) if the kind transitions state.
 *
 * The pulse and DO calls happen AFTER the insert is durable so a downstream
 * failure can't lose the event row. Pulse failures are swallowed. The DO
 * tick is AWAITED — a fire-and-forget tick here is cancelled by the
 * Workers runtime once the route returns, silently stranding the run in
 * `deploying` (#155 production incident: CI's `deploy_completed` was
 * recorded `ok:true` but the run never advanced). Tick failures never
 * fail the ingest (the event row is durable); they surface as
 * `tick: "failed:<message>"` in the response body plus a logged error
 * instead. With the tick awaited, a `duplicated: true` replay always
 * implies the original request's tick already completed — replays never
 * re-tick.
 */
export const ingest_event = async (
	deps: EventDeps,
	input: IngestEventInput,
): Promise<Result<IngestEventOutput, ServiceError | EventValidationError>> => {
	// (1) Load run + caller scope check.
	let run_row: typeof pipeline_run.$inferSelect | undefined;
	try {
		const rows = await deps.db.select().from(pipeline_run).where(eq(pipeline_run.id, input.run_id));
		run_row = rows.at(0);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to read pipeline_run ${input.run_id}: ${String(e)}`,
		} satisfies ServiceError);
	}
	if (!run_row) {
		return err({ kind: "not_found", resource: "pipeline_run", id: input.run_id } satisfies ServiceError);
	}
	const checked_run = parse_run_row(run_row);
	if (!checked_run.ok) return checked_run;
	run_row = checked_run.value;
	if (run_row.package_id !== input.package_id) {
		return err({
			kind: "forbidden",
			reason: "caller package_id does not match run",
			message: "caller package_id does not match run",
		} satisfies ServiceError);
	}

	// (2) Hash.
	const hash = await idempotency_hash(input.idempotency_key, input.payload);

	// (3) Idempotent insert — the partial unique index
	// `idx_pipeline_stage_event_idem_uniq` on `(run_id, idempotency_hash)`
	// where the hash is non-null makes the SELECT-then-INSERT pre-check
	// redundant: an existing row for the same (run, hash) is exactly a
	// unique violation on insert, which resolves as an idempotent replay
	// returning the stored row. Same-key-different-content collisions take
	// a DIFFERENT hash (no index violation) and are caught below by the
	// key-collision scan (validation_error, so callers can tell "replay"
	// from "key reused with new content").
	const key_collision = await find_key_collision(deps.db, input.run_id, input.idempotency_key, hash);
	if (key_collision.ok && key_collision.value !== null) {
		return err({
			kind: "validation_error",
			field: "idempotency_key",
			message: `idempotency_key ${input.idempotency_key} previously used with different payload`,
		} satisfies EventValidationError);
	}
	if (!key_collision.ok) return key_collision;

	// (4) Insert. Stamp `source: "external"` server-side — overrides
	// whatever the caller put in `payload.source`.
	const id = make_event_id();
	const now = new Date().toISOString();
	const payload_obj = stamp_external_source(input.payload, input.idempotency_key);
	try {
		const insert_values = {
			id,
			run_id: input.run_id,
			stage_name: input.stage_name,
			kind: input.kind,
			payload: payload_obj,
			ts: now,
			idempotency_hash: hash,
		};
		await deps.db.insert(pipeline_stage_event).values(insert_values);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (message.includes("UNIQUE constraint failed") && message.includes("pipeline_stage_event.idempotency_hash")) {
			const replayed: Array<{ id: string }> = await deps.db
				.select({ id: pipeline_stage_event.id })
				.from(pipeline_stage_event)
				.where(and(eq(pipeline_stage_event.run_id, input.run_id), eq(pipeline_stage_event.idempotency_hash, hash)));
			const existing_id = replayed.at(0)?.id;
			if (existing_id !== undefined) return ok({ event_id: existing_id, duplicated: true, tick: "skipped:duplicated" });
			return ok({ event_id: id, duplicated: true, tick: "skipped:duplicated" });
		}
		return err({
			kind: "store_error",
			operation: "insert_pipeline_stage_event",
			message: String(e),
		} satisfies ServiceError);
	}

	// (5a) Fire-and-forget pulse emit.
	void deps.pulse
		.emit({
			event: "stage_event_external",
			run_id: input.run_id,
			package_id: input.package_id,
			stage_name: input.stage_name,
			kind: input.kind,
		})
		.catch(() => undefined);

	// (5b) AWAITED DO tick for transition-relevant kinds only. The body
	// carries the stage name + raw payload so the DO side of external
	// events can validate stage + SHA before adopting the event (#155).
	// The tick must complete BEFORE this route responds: an unawaited
	// promise is cancelled by the Workers runtime once the response is
	// returned, so fire-and-forget here silently strands the run. The
	// outcome is parsed from the DO's `ExternalEventOutcome` body and
	// returned in `tick` so CI logs show whether the run advanced.
	let tick: IngestTick = "skipped:informational";
	if (TRANSITION_KINDS.has(input.kind)) {
		try {
			const response = await deps.do.fetch(input.run_id, "/external-event", {
				kind: "external_event",
				event_kind: input.kind,
				stage_name: input.stage_name,
				payload: input.payload ?? null,
			});
			tick = await tick_outcome_from(response);
		} catch (e) {
			tick = `failed:${e instanceof Error ? e.message : String(e)}`;
		}
		if (tick !== "applied" && !tick.startsWith("noop:")) {
			logger.error("external event tick did not apply", {
				run_id: input.run_id,
				kind: input.kind,
				stage_name: input.stage_name,
				tick,
			});
		}
	}

	return ok({ event_id: id, duplicated: false, tick });
};

/**
 * Map a DO `/external-event` response to a tick outcome. 2xx bodies carry
 * the `ExternalEventOutcome` (`{ acted: true, output }` or
 * `{ acted: false, reason }`); anything else — non-2xx status or an
 * unparseable body — is a `failed:` outcome with the best message
 * available.
 */
const TickErrorEnvelopeSchema = z.object({ error: z.object({ message: z.string() }).partial().optional() });
const TickValueEnvelopeSchema = z.object({
	value: z.object({ acted: z.boolean(), reason: z.string().optional() }).optional(),
});

const tick_outcome_from = async (response: Response): Promise<IngestTick> => {
	let body: unknown = null;
	try {
		const parsed_body: unknown = await response.json();
		body = parsed_body;
	} catch {
		body = null;
	}
	if (!response.ok) {
		const parsed = TickErrorEnvelopeSchema.safeParse(body);
		const message = parsed.success ? parsed.data.error?.message : undefined;
		return `failed:${message ?? `status_${String(response.status)}`}`;
	}
	const parsed = TickValueEnvelopeSchema.safeParse(body);
	const value = parsed.success ? parsed.data.value : undefined;
	if (value === undefined) return "failed:unreadable_tick_response";
	if (value.acted) return "applied";
	if (value.reason !== undefined) return `noop:${value.reason}`;
	return "failed:unreadable_tick_response";
};

// ─── Internal helpers ───────────────────────────────────────────────

/**
 * Wrap the caller-supplied payload into an object stamped with
 * `source: "external"` and the originating `idempotency_key`. The
 * key lives on the row so {@link find_key_collision} can detect a
 * caller reusing the same UUID for divergent content.
 *
 * Server-side authoritative: even if the input payload had its own
 * `source` field, we overwrite. Same for `idempotency_key`.
 */
const stamp_external_source = (payload: unknown, idempotency_key: string): Record<string, unknown> => {
	const base = is_record(payload) ? { ...payload } : { value: payload ?? null };
	return { ...base, source: "external", idempotency_key };
};

/**
 * Look up any existing event on this run that recorded the same
 * `idempotency_key` (via the embedded `payload.idempotency_key` field)
 * but a DIFFERENT `idempotency_hash`. Hit → caller reused a key with
 * divergent content; miss → safe to insert.
 *
 * D1's JSON1 functions (json_extract) are available; we use a string
 * LIKE probe on the raw text column instead so the query is portable to
 * bun:sqlite without the JSON1 extension wired in.
 */
const find_key_collision = async (
	db: Database,
	run_id: string,
	idempotency_key: string,
	current_hash: string,
): Promise<Result<PipelineStageEvent | null, ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id));
		for (const row of rows) {
			if (row.idempotency_hash === current_hash) continue;
			const payload = row.payload;
			if (payload && payload.idempotency_key === idempotency_key) {
				return ok(row);
			}
		}
		return ok(null);
	} catch (e) {
		return err({
			kind: "db_error",
			message: `failed to scan pipeline_stage_event for key collision: ${String(e)}`,
		} satisfies ServiceError);
	}
};
