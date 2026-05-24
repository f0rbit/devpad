/**
 * @module core/services/pipelines/dashboard
 *
 * Pure D1 aggregator for the pipeline observability dashboard (Phase 2.D).
 * Reads `pipeline_run`, `pipeline_stage_event`, `pipeline_approval` for a
 * single package over a time window and returns the `DashboardResponse`
 * shape declared in `@devpad/schema/validation`.
 *
 * Pulse-based latency snapshots are NOT computed here — that's the proxy
 * route's job (Phase 2.D.2). This file is intentionally D1-only so the
 * percentile / verdict-counting / rollback-rate maths can be exhaustively
 * tested with the bun:sqlite harness.
 *
 * Percentile choice: sort + nearest-rank at `floor(N * 0.5)` / `floor(N * 0.95)`.
 * No interpolation. Documented in `compute_percentile` below — kept this
 * simple because the dashboard's purpose is at-a-glance triage, not
 * stats-textbook precision.
 */

import type { DashboardResponse } from "@devpad/schema/validation";
import { pipeline_approval, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq, gte } from "drizzle-orm";
import type { ServiceError } from "../errors.js";

// ─── Types ──────────────────────────────────────────────────────────

export type DashboardSnapshot = DashboardResponse;

export type GetDashboardInput = {
	package_id: string;
	window_ms: number;
	/** Reference time for the window; defaults to `Date.now()`. Mostly for tests. */
	now?: Date;
};

export type DashboardDeps = {
	db: Database;
};

// ─── Constants ──────────────────────────────────────────────────────

/**
 * Stage-event payloads carrying a verdict are tagged `kind === "gate_verdict"`.
 * Within those, `payload.verdict` is `"pass" | "fail" | "pending"`. The gate
 * TYPE (`manual` / `auto` / `analysis`) comes from looking up the run's
 * `resolved_gates` JSON by the event's `stage_name` — NOT hard-coded.
 */
const VERDICT_VALUES = ["pass", "fail", "pending"] as const;
type VerdictValue = (typeof VERDICT_VALUES)[number];

const GATE_TYPES = ["manual", "auto", "analysis"] as const;
type GateType = (typeof GATE_TYPES)[number];

const is_verdict_value = (v: unknown): v is VerdictValue => typeof v === "string" && (VERDICT_VALUES as readonly string[]).includes(v);

const is_gate_type = (v: unknown): v is GateType => typeof v === "string" && (GATE_TYPES as readonly string[]).includes(v);

// ─── Pure helpers ───────────────────────────────────────────────────

/**
 * Nearest-rank percentile on a sorted-on-the-fly array of finite numbers.
 *
 * - `N === 0` → `null` (caller renders as "—").
 * - `N === 1` → returns that single value (p50 = p95 = the value).
 * - Otherwise: sort ascending, index at `floor(N * p)`. Clamped to `N - 1`
 *   so `p === 1` doesn't read past the end.
 *
 * Trade-off: no interpolation. We accept the small step-function bias at
 * low sample sizes because the dashboard is for human triage, not for
 * SLO accounting.
 */
export const compute_percentile = (values: readonly number[], p: number): number | null => {
	if (values.length === 0) return null;
	if (values.length === 1) return values[0] ?? null;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
	return sorted[idx] ?? null;
};

/**
 * Group `gate_verdict` events by the gate type recorded in the matching
 * run's `resolved_gates` JSON.
 *
 * `resolved_gates` is a `Record<TransitionKey, { type: "manual" | "auto" | "analysis" }>`
 * keyed by `"<from-stage>→<to-stage>"`. An event's `stage_name` is the
 * source stage; the verdict applies to the transition leaving that stage,
 * so we search the run's resolved_gates for any key starting with
 * `"<stage_name>→"` (each stage has at most one outbound gate).
 *
 * Unknown gate type → silently dropped (e.g. event for a stage that
 * doesn't appear in resolved_gates — shouldn't happen in production but
 * we don't want the dashboard to crash).
 */
export const group_verdicts = (
	events: ReadonlyArray<{ run_id: string; stage_name: string; payload: unknown }>,
	resolved_gates_by_run: ReadonlyMap<string, Record<string, unknown>>
): DashboardResponse["verdict_counts"] => {
	const buckets: DashboardResponse["verdict_counts"] = {
		manual: { pass: 0, fail: 0, pending: 0 },
		auto: { pass: 0, fail: 0, pending: 0 },
		analysis: { pass: 0, fail: 0, pending: 0 },
	};

	for (const event of events) {
		const verdict = extract_verdict(event.payload);
		if (!verdict) continue;

		const gates = resolved_gates_by_run.get(event.run_id);
		if (!gates) continue;

		const gate_type = lookup_gate_type(gates, event.stage_name);
		if (!gate_type) continue;

		buckets[gate_type][verdict] += 1;
	}

	return buckets;
};

const extract_verdict = (payload: unknown): VerdictValue | null => {
	if (payload === null || typeof payload !== "object") return null;
	const raw = (payload as Record<string, unknown>).verdict;
	return is_verdict_value(raw) ? raw : null;
};

const lookup_gate_type = (resolved_gates: Record<string, unknown>, from_stage: string): GateType | null => {
	const prefix = `${from_stage}→`;
	for (const [key, value] of Object.entries(resolved_gates)) {
		if (!key.startsWith(prefix)) continue;
		if (value === null || typeof value !== "object") continue;
		const t = (value as Record<string, unknown>).type;
		if (is_gate_type(t)) return t;
	}
	return null;
};

/**
 * `rollback_rate = rollback_run_count / deploy_run_count`.
 *
 * Returns `null` when there are no deploy runs in the window — never
 * `Infinity` or `NaN`. Counts use `pipeline_run.kind`, NOT stage events.
 * A rollback run is one whose `kind === "rollback"` (created by the
 * `/rollback` endpoint; see runs.ts §rollback synthesis).
 */
export const count_rollbacks = (runs: ReadonlyArray<{ kind: string }>): { deploys: number; rollbacks: number; rate: number | null } => {
	let deploys = 0;
	let rollbacks = 0;
	for (const r of runs) {
		if (r.kind === "deploy") deploys += 1;
		else if (r.kind === "rollback") rollbacks += 1;
	}
	const rate = deploys === 0 ? null : rollbacks / deploys;
	return { deploys, rollbacks, rate };
};

// ─── Run-counts helper ──────────────────────────────────────────────

/**
 * Status → counter slot. Statuses outside this map are ignored (defensive
 * against future schema additions). `total` is incremented for every run
 * regardless. "In-flight" rolls up the four transitional statuses so the
 * dashboard panel can show one "still running" KPI.
 */
const IN_FLIGHT_STATUSES = new Set<string>(["queued", "deploying", "baking", "awaiting_approval", "rolling_back"]);

const count_runs = (runs: ReadonlyArray<{ status: string }>): DashboardResponse["run_counts"] => {
	const counts = { total: 0, completed: 0, failed: 0, cancelled: 0, rolled_back: 0, in_flight: 0 };
	for (const r of runs) {
		counts.total += 1;
		switch (r.status) {
			case "completed":
				counts.completed += 1;
				break;
			case "failed":
				counts.failed += 1;
				break;
			case "cancelled":
				counts.cancelled += 1;
				break;
			case "rolled_back":
				counts.rolled_back += 1;
				break;
			default:
				if (IN_FLIGHT_STATUSES.has(r.status)) counts.in_flight += 1;
		}
	}
	return counts;
};

// ─── Latency helpers ────────────────────────────────────────────────

const parse_iso = (s: string | null): number | null => {
	if (!s) return null;
	const ms = Date.parse(s);
	return Number.isFinite(ms) ? ms : null;
};

const run_durations = (runs: ReadonlyArray<{ started_at: string | null; finished_at: string | null; status: string }>): number[] => {
	const out: number[] = [];
	for (const r of runs) {
		// Schema field is `finished_at`; the plan refers to "completed_at" — same
		// column, the plan was written against an earlier draft. Only count
		// terminal runs that actually completed (not cancelled/failed mid-flight,
		// where the duration is "time spent before giving up" — not a useful KPI).
		if (r.status !== "completed") continue;
		const start = parse_iso(r.started_at);
		const finish = parse_iso(r.finished_at);
		if (start === null || finish === null) continue;
		const ms = finish - start;
		if (ms < 0) continue;
		out.push(ms);
	}
	return out;
};

const approval_turnarounds = (rows: ReadonlyArray<{ created_at: string | null; decided_at: string | null }>): number[] => {
	const out: number[] = [];
	for (const r of rows) {
		const created = parse_iso(r.created_at);
		const decided = parse_iso(r.decided_at);
		if (created === null || decided === null) continue;
		const ms = decided - created;
		if (ms < 0) continue;
		out.push(ms);
	}
	return out;
};

// ─── get_dashboard ──────────────────────────────────────────────────

/**
 * Read every pipeline_run for the package whose `started_at` falls within
 * the window, then derive the dashboard snapshot in-memory.
 *
 * We filter on `started_at` instead of `created_at` so runs queued before
 * the window opened but actually started inside it still count — the
 * dashboard answers "what happened in this window?", which is about
 * execution time, not enqueue time.
 *
 * Empty window → zeros across the board + null percentiles + null
 * rollback_rate. The Zod schema's `nullable()` for percentiles and the
 * `.min(0).max(1).nullable()` for rollback_rate are the source of truth.
 */
export const get_dashboard = async (deps: DashboardDeps, input: GetDashboardInput): Promise<Result<DashboardSnapshot, ServiceError>> => {
	const now = input.now ?? new Date();
	const window_start = new Date(now.getTime() - input.window_ms).toISOString();

	// (1) Runs in window.
	let runs: Array<{ id: string; kind: string; status: string; started_at: string | null; finished_at: string | null; resolved_gates: unknown }>;
	try {
		runs = await deps.db
			.select({
				id: pipeline_run.id,
				kind: pipeline_run.kind,
				status: pipeline_run.status,
				started_at: pipeline_run.started_at,
				finished_at: pipeline_run.finished_at,
				resolved_gates: pipeline_run.resolved_gates,
			})
			.from(pipeline_run)
			.where(and(eq(pipeline_run.package_id, input.package_id), gte(pipeline_run.started_at, window_start)));
	} catch (e) {
		return err({ kind: "db_error", message: `failed to read pipeline_run: ${String(e)}` } satisfies ServiceError);
	}

	const run_ids = runs.map(r => r.id);
	const resolved_gates_by_run = new Map<string, Record<string, unknown>>(
		runs.map(r => [r.id, (r.resolved_gates as Record<string, unknown> | null) ?? {}])
	);

	// (2) gate_verdict events for those runs.
	let verdict_events: Array<{ run_id: string; stage_name: string; payload: unknown }> = [];
	if (run_ids.length > 0) {
		try {
			const rows = await deps.db
				.select({
					run_id: pipeline_stage_event.run_id,
					stage_name: pipeline_stage_event.stage_name,
					payload: pipeline_stage_event.payload,
				})
				.from(pipeline_stage_event)
				.where(eq(pipeline_stage_event.kind, "gate_verdict"));
			const run_id_set = new Set(run_ids);
			verdict_events = rows.filter(r => run_id_set.has(r.run_id));
		} catch (e) {
			return err({ kind: "db_error", message: `failed to read pipeline_stage_event: ${String(e)}` } satisfies ServiceError);
		}
	}

	// (3) Approvals for those runs (decided only — pending approvals have no turnaround).
	let approvals: Array<{ created_at: string | null; decided_at: string | null }> = [];
	if (run_ids.length > 0) {
		try {
			const rows = await deps.db
				.select({
					run_id: pipeline_approval.run_id,
					created_at: pipeline_approval.created_at,
					decided_at: pipeline_approval.decided_at,
				})
				.from(pipeline_approval);
			const run_id_set = new Set(run_ids);
			approvals = rows.filter(r => run_id_set.has(r.run_id) && r.decided_at !== null);
		} catch (e) {
			return err({ kind: "db_error", message: `failed to read pipeline_approval: ${String(e)}` } satisfies ServiceError);
		}
	}

	// (4) Derive.
	const run_counts = count_runs(runs);
	const verdict_counts = group_verdicts(verdict_events, resolved_gates_by_run);
	const durations = run_durations(runs);
	const turnarounds = approval_turnarounds(approvals);
	const { rate: rollback_rate } = count_rollbacks(runs);

	const snapshot: DashboardSnapshot = {
		run_counts,
		verdict_counts,
		latency_p50_ms: compute_percentile(durations, 0.5),
		latency_p95_ms: compute_percentile(durations, 0.95),
		approval_turnaround_p50_ms: compute_percentile(turnarounds, 0.5),
		rollback_rate,
	};

	return ok(snapshot);
};
