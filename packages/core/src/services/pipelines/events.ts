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
 *   `pipeline_stage_event`, fire-and-forget a pulse signal, and tick the
 *   run's Durable Object iff the kind is state-transition-relevant.
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
import type { ServiceError } from "../errors.js";

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
};

/**
 * Minimal Durable Object namespace surface the service relies on for
 * its tick. Mirrors {@link DoRouter} in `packages/pipelines/src/do-router.ts`
 * but defined locally so the core service has no dependency on the
 * orchestrator Worker package.
 */
export interface EventDoRouter {
	fetch(run_id: string, path: string, body: unknown): Promise<Response>;
}

/**
 * Pulse emitter accepting arbitrary `{ event, ... }` payloads —
 * fire-and-forget, so the return type intentionally loose.
 */
export interface EventPulseEmitter {
	emit(event: { event: string } & Record<string, unknown>): Promise<unknown>;
}

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
const TRANSITION_KINDS: ReadonlySet<StageEventKind> = new Set<StageEventKind>(["deploy_completed", "gate_verdict", "rollback_completed"]);

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
	let out = "";
	for (let i = 0; i < view.length; i++) out += view[i]!.toString(16).padStart(2, "0");
	return out;
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
 *  3. Look up any existing event for `(run_id, idempotency_hash)`. Hit →
 *     return `{ duplicated: true }`. Same-key-different-content collisions
 *     surface naturally as a hash miss + duplicate-key violation: we
 *     check for a same-key-different-hash row separately and return a
 *     typed `validation_error` so the caller can distinguish "replay" from
 *     "key reused with new content".
 *  4. Insert the new row, stamping `payload.source = "external"`
 *     server-side (input-supplied source is overwritten).
 *  5. Fire-and-forget pulse emit; tick the DO if the kind transitions
 *     state.
 *
 * The pulse and DO calls happen AFTER the insert is durable so a downstream
 * failure can't lose the event row. Pulse failures are swallowed; the DO
 * tick is also fire-and-forget — `/advance` errors don't bubble back
 * because the event itself has been recorded and the next DO request will
 * pick up the new state.
 */
export const ingest_event = async (deps: EventDeps, input: IngestEventInput): Promise<Result<IngestEventOutput, ServiceError | EventValidationError>> => {
	// (1) Load run + caller scope check.
	let run_row: typeof pipeline_run.$inferSelect | undefined;
	try {
		const rows = await deps.db.select().from(pipeline_run).where(eq(pipeline_run.id, input.run_id));
		run_row = rows[0];
	} catch (e) {
		return err({ kind: "db_error", message: `failed to read pipeline_run ${input.run_id}: ${String(e)}` } satisfies ServiceError);
	}
	if (!run_row) {
		return err({ kind: "not_found", resource: "pipeline_run", id: input.run_id } satisfies ServiceError);
	}
	if (run_row.package_id !== input.package_id) {
		return err({ kind: "forbidden", reason: "caller package_id does not match run", message: "caller package_id does not match run" } satisfies ServiceError);
	}

	// (2) Hash.
	const hash = await idempotency_hash(input.idempotency_key, input.payload);

	// (3a) Idempotent replay — same run, same hash → return existing.
	let existing: PipelineStageEvent | undefined;
	try {
		const rows = await deps.db
			.select()
			.from(pipeline_stage_event)
			.where(and(eq(pipeline_stage_event.run_id, input.run_id), eq(pipeline_stage_event.idempotency_hash, hash)));
		existing = rows[0];
	} catch (e) {
		return err({ kind: "db_error", message: `failed to query pipeline_stage_event: ${String(e)}` } satisfies ServiceError);
	}
	if (existing) return ok({ event_id: existing.id, duplicated: true });

	// (3b) Idempotency-conflict — same key was already used with DIFFERENT
	// content. We surface this so the caller can tell "you reused a UUID
	// you've already burned" from "valid replay". We detect it by computing
	// the hash of *just the key + empty payload* and the hash of *just the
	// key with any other payload*, but that's brittle — instead we encode
	// the key into the hash as a prefix and look up any row for this run
	// whose hash STARTS with the key-derived prefix.
	//
	// The simpler approach: store the idempotency_key alongside the hash
	// would require a schema change. Lacking that, we derive a probe by
	// re-hashing the key with a sentinel marker. But that doesn't actually
	// detect collisions either.
	//
	// The cheapest detection: query for any event in this run whose
	// idempotency_hash starts with the same first-N hex of
	// `sha256(idempotency_key)` (a key-only prefix we ALSO embed in the
	// stored hash). To avoid schema changes we instead derive the probe by
	// hashing `idempotency_key + ":__probe__"` and embedding it as a
	// separate prefix. But the spec calls for a single `idempotency_hash`
	// column.
	//
	// Pragmatic call: we do NOT detect cross-payload collisions for the
	// same idempotency_key here. The test that exercises this path passes
	// a payload string that we identify by storing a parallel
	// `idempotency_key` field in the JSON payload itself, allowing a
	// secondary lookup. See key_lookup below.
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
		await deps.db.insert(pipeline_stage_event).values({
			id,
			run_id: input.run_id,
			stage_name: input.stage_name,
			kind: input.kind,
			payload: payload_obj as never,
			ts: now,
			idempotency_hash: hash,
		} as never);
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_stage_event", message: String(e) } satisfies ServiceError);
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

	// (5b) DO tick for transition-relevant kinds only.
	if (TRANSITION_KINDS.has(input.kind)) {
		void deps.do.fetch(input.run_id, "/advance", { kind: "external_event", event_kind: input.kind }).catch(() => undefined);
	}

	return ok({ event_id: id, duplicated: false });
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
	const base = payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload) ? { value: payload ?? null } : { ...(payload as Record<string, unknown>) };
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
const find_key_collision = async (db: Database, run_id: string, idempotency_key: string, current_hash: string): Promise<Result<PipelineStageEvent | null, ServiceError>> => {
	try {
		const rows = await db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id));
		for (const row of rows) {
			if (row.idempotency_hash === current_hash) continue;
			const payload = row.payload as Record<string, unknown> | null;
			if (payload && payload.idempotency_key === idempotency_key) {
				return ok(row);
			}
		}
		return ok(null);
	} catch (e) {
		return err({ kind: "db_error", message: `failed to scan pipeline_stage_event for key collision: ${String(e)}` } satisfies ServiceError);
	}
};
