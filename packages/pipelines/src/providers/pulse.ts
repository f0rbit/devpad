/**
 * @module pipelines/providers/pulse
 *
 * Production wrappers around the pulse service binding (#158).
 *
 * - {@link make_pulse_emitter} — HTTP `POST /e` (pulse's real ingest route,
 *   authenticated with an `X-Pulse-Key: pk_*` ingest key). Each event maps
 *   onto pulse's generic custom event: `name: "event"`, the orchestrator
 *   event kind becomes `properties.name`, and the caller dimensions
 *   (`package`/`environment`/`version_id`) live in `properties` too —
 *   pulse's event schema has NO top-level dimension fields (they would be
 *   silently stripped by Zod), mirroring the canonical emitter in
 *   `~/dev/vault/src/pulse-emitter.ts`. Matches the {@link PulseEmitter}
 *   interface in `@devpad/core`.
 * - {@link make_pulse_summary_client} — reads `GET /events/:project_id`
 *   (devpad-bearer auth) and aggregates the events matching the query's
 *   dimensions into a {@link MetricSnapshot} for analysis gates.
 *   `GET /summary/:project_id` cannot filter by those dimensions, so the
 *   events read-back is the faithful route. Matches the
 *   {@link PulseSummaryProvider} interface in `@devpad/pipeline-fakes`.
 *
 * Both wrap an `env.PULSE` `Fetcher` so the same code paths work in
 * miniflare / production. No retries here — the gate evaluators decide
 * what failure means. Unconfigured observability never blocks deploys:
 * the emitter no-ops, the summary client returns `not_configured`.
 */

import type { Fetcher } from "@cloudflare/workers-types";
import { err, ok, pipe, try_catch_async, type Result } from "@f0rbit/corpus";
import type { EmitError, PulseEmitter, PulseEvent } from "@devpad/core/services/pipelines/gates";
import { createLogger } from "@devpad/core/utils/logger";
import type {
	MetricSnapshot,
	PulseSummaryError as PulseError,
	PulseSummaryProvider,
	PulseSummaryQuery,
} from "@devpad/pipeline-fakes";
import { z } from "zod";

const log = createLogger("pipelines:pulse");

/**
 * Max events per ingest request. `pulse` 500s on batches of 10+ until its
 * insert-chunking lands upstream (f0rbit/pulse#13) — same limit vault's
 * emitter carries. Every multi-event path in this module chunks through
 * {@link chunk_events}.
 */
export const MAX_PULSE_BATCH = 9;

// Service-binding fetch ignores the host — only the path routes to the
// pulse Worker (same convention as vault's emitter).
const PULSE_BINDING_HOST = "https://pulse";
const PULSE_INGEST_PATH = "/e";

/** Read cap per `/events` page + the max pages one aggregation walks. */
const EVENTS_PAGE_LIMIT = 500;
const EVENTS_MAX_PAGES = 2;

/** Split `events` into consecutive batches of at most `max` items. */
export const chunk_events = <T>(events: readonly T[], max: number): T[][] =>
	events.reduce<T[][]>((batches, event) => {
		const last = batches.at(-1);
		if (last !== undefined && last.length < max) {
			last.push(event);
		} else {
			batches.push([event]);
		}
		return batches;
	}, []);

/**
 * Lazily-read secret credential shared by both clients: Secrets Store
 * secrets resolve per use (never throw — failures surface as typed errors);
 * `undefined` is the "not bound on this Worker" signal that drives the
 * unconfigured behaviour (emitter no-op / summary `not_configured`).
 */
export type PulseSecretRef = { get(): Promise<string> } | undefined;

export type PulseEmitterConfig = {
	/** Body `project_id` for `POST /e` — must match the ingest key's project. */
	project_id: string | undefined;
	/** Resolves the `pk_*` plaintext for the `X-Pulse-Key` header. */
	ingest_key: PulseSecretRef;
};

/**
 * Wire shape of one event inside pulse's ingest batch. Pulse's event schema
 * has no top-level caller dimensions, so package/environment/version_id ride
 * inside `properties` (mirrors vault's pulse-emitter).
 */
export type PulseWireEvent = {
	name: "event";
	properties: { name: string; package: string; environment: string; version_id: string } & Record<string, unknown>;
};

/**
 * Derive caller dimensions for the properties bag. Run-level events carry
 * `stage` (the analysis-gate events aggregate by stage, which is the same
 * value gate queries use as `environment`) and route-level events carry
 * `package_id` — both map onto the pulse-side dimension names. Missing
 * dimensions read as `"unknown"` rather than being dropped, so every event
 * stays queryable by the dimension filters.
 */
export const to_pulse_wire_event = (event: { event: string } & Record<string, unknown>): PulseWireEvent => ({
	name: "event",
	properties: {
		...event,
		name: event.event,
		package: typeof event.package_id === "string" ? event.package_id : "unknown",
		environment:
			typeof event.stage === "string" || typeof event.environment === "string"
				? String(event.stage ?? event.environment)
				: "unknown",
		version_id: typeof event.version_id === "string" ? event.version_id : "unknown",
	},
});

const emit_chunk = async (
	pulse: Fetcher,
	project_id: string,
	ingest_key: string,
	events: PulseWireEvent[],
): Promise<Result<void, EmitError>> =>
	pipe
		.try(
			() =>
				pulse.fetch(`${PULSE_BINDING_HOST}${PULSE_INGEST_PATH}`, {
					method: "POST",
					headers: { "content-type": "application/json", "X-Pulse-Key": ingest_key },
					body: JSON.stringify({ project_id, events }),
				}),
			(cause): EmitError => ({ kind: "emit_error", message: `pulse fetch failed: ${String(cause)}` }),
		)
		.flat_map(async (response): Promise<Result<void, EmitError>> => {
			if (response.status >= 400) {
				const text = await response.text().catch(() => "");
				return err({ kind: "emit_error", message: `pulse ingest ${String(response.status)}: ${text}` });
			}
			return ok(undefined);
		})
		.result();

const send_pulse_events = async (
	pulse: Fetcher,
	project_id: string,
	ingest_key: string,
	events: PulseWireEvent[],
): Promise<Result<void, EmitError>> => {
	for (const batch of chunk_events(events, MAX_PULSE_BATCH)) {
		const result = await emit_chunk(pulse, project_id, ingest_key, batch);
		if (!result.ok) return result;
	}
	return ok(undefined);
};

/**
 * Silent no-op for when pulse credentials aren't configured — gate emits are
 * fire-and-forget telemetry, so unconfigured observability must not spam the
 * caller's log path with noise it cannot act on. Warns once per emitter.
 */
const not_configured_emitter = (): PulseEmitter => {
	let warned = false;
	return {
		emit: async () => {
			if (!warned) {
				warned = true;
				log.warn("pulse emitter not configured (PULSE_PROJECT_ID / PULSE_INGEST_KEY unbound) — events dropped");
			}
			return ok(undefined);
		},
	};
};

const build_key_loader = (secret_ref: NonNullable<PulseSecretRef>): (() => Promise<Result<string, string>>) => {
	let cached: Result<string, string> | null = null;
	return async () => {
		if (cached !== null) return cached;
		const loaded = await try_catch_async(
			() => secret_ref.get(),
			(cause) => String(cause),
		);
		if (loaded.ok) cached = loaded;
		return loaded;
	};
};

/**
 * Build a {@link PulseEmitter} backed by the orchestrator's `env.PULSE`
 * service binding. Without `project_id` or the ingest key the emitter
 * degrades to the silent no-op.
 */
export const make_pulse_emitter = (pulse: Fetcher, config: PulseEmitterConfig): PulseEmitter => {
	if (config.project_id === undefined || config.project_id === "" || config.ingest_key === undefined) {
		return not_configured_emitter();
	}
	const project_id = config.project_id;
	const load_key = build_key_loader(config.ingest_key);
	return {
		emit: async (event: PulseEvent): Promise<Result<void, EmitError>> => {
			const key_result = await load_key();
			if (!key_result.ok) {
				return err({ kind: "emit_error", message: `pulse ingest key unavailable: ${key_result.error}` });
			}
			return send_pulse_events(pulse, project_id, key_result.value, [to_pulse_wire_event(event)]);
		},
	};
};

/* ── summary read-back ─────────────────────────────────────────────── */

const pulse_event_row_schema = z.object({
	id: z.number(),
	project_id: z.string(),
	name: z.string(),
	ts: z.number(),
	session_id: z.string(),
	level: z.string().nullable().optional(),
	release: z.string().nullable().optional(),
	properties: z.union([z.record(z.string(), z.unknown()), z.string(), z.null()]).optional(),
});

/**
 * Wire shape of pulse's `GET /events/:project_id` response (mirrors
 * `EventsPage` in `~/dev/pulse/packages/core/src/query.ts` — keep in sync
 * by hand when pulse's read shapes change).
 */
export const pulse_events_page_schema = z.object({
	events: z.array(pulse_event_row_schema),
	next_cursor: z.string().optional(),
});

export type PulseEventRow = z.infer<typeof pulse_event_row_schema>;

/**
 * Does one read-back row match the gate query's dimension triple? Dimensions
 * live in `properties` (see {@link to_pulse_wire_event}); rows without the
 * exact triple are excluded from aggregation rather than folded into
 * "unknown" so untagged noise cannot contaminate a gate verdict.
 */
export const event_matches_query = (row: PulseEventRow, query: PulseSummaryQuery): boolean => {
	const props = typeof row.properties === "object" && row.properties !== null ? row.properties : undefined;
	return (
		props !== undefined &&
		props.package === query.package &&
		props.environment === query.environment &&
		props.version_id === query.version_id
	);
};

const p95 = (values: number[]): number | undefined => {
	if (values.length === 0) return undefined;
	const sorted = [...values].toSorted((a, b) => a - b);
	const rank = Math.ceil(0.95 * sorted.length) - 1;
	return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
};

const numeric_prop = (row: PulseEventRow, key: string): number | undefined => {
	const props = typeof row.properties === "object" && row.properties !== null ? row.properties : undefined;
	const raw = props?.[key];
	return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
};

/**
 * Aggregate the dimension-filtered read-back rows into a gate snapshot.
 * Pure over `[rows, query, now_ms]`.
 *
 * Metric-name mapping for analysis templates (the DSL in
 * `pipeline_analysis_template.threshold_dsl` should reference these names):
 * - `events_total` — matching events in the window (=`sample_count`)
 * - `pageviews`, `sessions`, `request_count`, `errors` — pulse's own
 *   top-line summary semantics, restricted to the matching rows
 * - `request_rate` — request_count per minute over the window
 * - `error_rate` — errors / request_count (1 when only errors, 0 when
 *   neither), so a traffic-starved window reads fail-open-friendly
 * - `latency_p95_ms` — p95 over `properties.duration_ms` of request rows
 * `request`/`error` events only count when the workload emitted them into
 * the same pulse project carrying the same `properties.*` dimensions.
 */
export const aggregate_rows = (rows: PulseEventRow[], query: PulseSummaryQuery, now_ms: number): MetricSnapshot => {
	const request_count = rows.filter((row) => row.name === "request").length;
	const error_count = rows.filter((row) => row.name === "error").length;
	const minutes = query.window_ms / 60_000;
	const durations = rows
		.filter((row) => row.name === "request")
		.map((row) => numeric_prop(row, "duration_ms"))
		.filter((d): d is number => d !== undefined);
	const metrics: Record<string, number> = {
		events_total: rows.length,
		pageviews: rows.filter((row) => row.name === "pageview").length,
		sessions: new Set(rows.map((row) => row.session_id)).size,
		request_count,
		errors: error_count,
		request_rate: minutes > 0 ? request_count / minutes : request_count,
		error_rate: request_count > 0 ? error_count / request_count : error_count > 0 ? 1 : 0,
	};
	const latency_p95_ms = p95(durations);
	if (latency_p95_ms !== undefined) metrics.latency_p95_ms = latency_p95_ms;
	return {
		metrics,
		window_start_ms: now_ms - query.window_ms,
		window_end_ms: now_ms,
		sample_count: rows.length,
	};
};

/**
 * Read a fetch response body as the explicit `unknown` slot the boundary
 * rule sanctions (return position inside a `Promise<unknown>`-typed
 * function). Never throws — rejection propagates to the caller's
 * `try_catch_async` wrap.
 */
export const read_json_body = async (response: Response): Promise<unknown> => response.json();

const error_status_code = (status: number): PulseError["code"] => {
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 400 || status === 404 || status === 422) return "validation";
	return "internal";
};

const read_events_page = async (
	pulse: Fetcher,
	project_id: string,
	ts_from: number,
	ts_to: number,
	cursor: string | undefined,
	read_key: string,
): Promise<Result<{ events: PulseEventRow[]; next_cursor: string | undefined }, PulseError>> => {
	const params = new URLSearchParams({
		ts_from: String(ts_from),
		ts_to: String(ts_to),
		limit: String(EVENTS_PAGE_LIMIT),
	});
	if (cursor !== undefined) params.set("cursor", cursor);
	const url = `${PULSE_BINDING_HOST}/events/${project_id}?${params.toString()}`;
	return pipe
		.try(
			() =>
				pulse.fetch(url, {
					method: "GET",
					headers: { authorization: `Bearer ${read_key}` },
				}),
			(cause): PulseError => ({ code: "network", message: `pulse events fetch failed: ${String(cause)}` }),
		)
		.flat_map(
			async (response): Promise<Result<{ events: PulseEventRow[]; next_cursor: string | undefined }, PulseError>> => {
				if (response.status >= 400) {
					const text = await response.text().catch(() => "");
					return err({
						code: error_status_code(response.status),
						message: text || `pulse events ${String(response.status)}`,
					});
				}
				const body_result = await try_catch_async(
					() => read_json_body(response),
					(cause) => String(cause),
				);
				if (!body_result.ok) {
					return err({ code: "validation", message: `pulse events returned non-json: ${body_result.error}` });
				}
				const decoded = pulse_events_page_schema.safeParse(body_result.value);
				if (!decoded.success) {
					return err({
						code: "validation",
						message: `pulse events response failed schema validation: ${
							decoded.error.issues.at(0)?.message ?? decoded.error.message
						}`,
					});
				}
				return ok({ events: decoded.data.events, next_cursor: decoded.data.next_cursor });
			},
		)
		.result();
};

export type PulseSummaryConfig = {
	/** Query routes are project-scoped (`GET /events/:project_id`). */
	project_id: string | undefined;
	/** Resolves the devpad API key (scope `pulse`) sent as the Bearer credential. */
	read_key: PulseSecretRef;
};

/**
 * Build a {@link PulseSummaryProvider} backed by `env.PULSE`. Unbound
 * config → typed `not_configured` (analysis gates keep their documented
 * fail-open-with-reason behaviour). Configured → bounded read-back
 * (≤ {@link EVENTS_MAX_PAGES} pages of ≤ {@link EVENTS_PAGE_LIMIT} events)
 * filtered by the query's dimension triple, aggregated into a snapshot.
 */
export const make_pulse_summary_client = (pulse: Fetcher, config: PulseSummaryConfig): PulseSummaryProvider => {
	if (config.project_id === undefined || config.project_id === "" || config.read_key === undefined) {
		return {
			fetch: async () =>
				err({
					code: "not_configured",
					message:
						"pulse read key or project id unbound (PULSE_PROJECT_ID / PULSE_READ_KEY) — analysis metrics unavailable; gate falls open",
				}),
		};
	}
	const project_id = config.project_id;
	const load_key = build_key_loader(config.read_key);
	return {
		fetch: async (query: PulseSummaryQuery): Promise<Result<MetricSnapshot, PulseError>> => {
			const key_result = await load_key();
			if (!key_result.ok) {
				return err({ code: "unauthorized", message: `pulse read key unavailable: ${key_result.error}` });
			}
			const read_key = key_result.value;
			const now_ms = Date.now();
			const rows: PulseEventRow[] = [];
			let cursor: string | undefined;
			for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
				const result = await read_events_page(pulse, project_id, now_ms - query.window_ms, now_ms, cursor, read_key);
				if (!result.ok) return err(result.error);
				rows.push(...result.value.events);
				cursor = result.value.next_cursor;
				if (cursor === undefined) break;
			}
			return ok(
				aggregate_rows(
					rows.filter((row) => event_matches_query(row, query)),
					query,
					now_ms,
				),
			);
		},
	};
};
