import { err, ok, type Result } from "@f0rbit/corpus";

/**
 * Pure domain layer for the `analysis` gate. No DB, no HTTP, no clock — every
 * input (current time, metric snapshot, thresholds) is passed by value. The
 * side-effecting evaluator in `analysis.ts` reads from D1 + pulse and routes
 * the values through these functions.
 *
 * DSL is intentionally minimal for Phase 2:
 *     metric_name OP value [: pending]
 *
 * - `OP` is one of `>`, `<`, `>=`, `<=`, `=`
 * - trailing `: pending` flags a threshold whose breach yields a `Pending`
 *   verdict (insufficient traffic etc.) rather than `Fail`
 *
 * Example threshold DSL:
 *     error_rate > 0.01
 *     p99_latency_ms > 500
 *     request_rate < 10 : pending
 */

export type ThresholdOp = ">" | "<" | ">=" | "<=" | "=";

export type Threshold = {
	metric: string;
	op: ThresholdOp;
	value: number;
	on_fail: "Fail" | "Pending";
	reason_template?: string;
};

export type MetricSnapshot = {
	metrics: Record<string, number>;
	window_start_ms: number;
	window_end_ms: number;
	sample_count: number;
};

export type AnalysisVerdict = { verdict: "Pass"; reason?: string } | { verdict: "Fail"; reason: string } | { verdict: "Pending"; reason: string };

export type ParseError = {
	kind: "parse_error";
	line: number;
	raw: string;
	message: string;
};

const OPS: ReadonlyArray<ThresholdOp> = [">=", "<=", ">", "<", "="];

const split_lines = (dsl: string): Array<{ line: number; raw: string }> =>
	dsl
		.split("\n")
		.map((raw, i) => ({ line: i + 1, raw: raw.trim() }))
		.filter(l => l.raw.length > 0 && !l.raw.startsWith("#"));

const find_op = (s: string): ThresholdOp | null => OPS.find(op => s.includes(op)) ?? null;

const parse_pending_suffix = (rhs: string): { value_part: string; on_fail: "Fail" | "Pending" } => {
	const idx = rhs.indexOf(":");
	if (idx === -1) return { value_part: rhs, on_fail: "Fail" };
	const tag = rhs
		.slice(idx + 1)
		.trim()
		.toLowerCase();
	return {
		value_part: rhs.slice(0, idx).trim(),
		on_fail: tag === "pending" ? "Pending" : "Fail",
	};
};

const parse_line = (line: number, raw: string): Result<Threshold, ParseError> => {
	const op = find_op(raw);
	if (!op) {
		return err({ kind: "parse_error", line, raw, message: `no comparison operator (expected one of ${OPS.join(" ")})` });
	}
	const op_idx = raw.indexOf(op);
	const metric = raw.slice(0, op_idx).trim();
	if (!metric) return err({ kind: "parse_error", line, raw, message: "empty metric name" });

	const rhs = raw.slice(op_idx + op.length).trim();
	const { value_part, on_fail } = parse_pending_suffix(rhs);
	const value = Number(value_part);
	if (!Number.isFinite(value)) {
		return err({ kind: "parse_error", line, raw, message: `value "${value_part}" is not a finite number` });
	}

	return ok({ metric, op, value, on_fail });
};

/**
 * Parse the multi-line threshold DSL stored in
 * `pipeline_analysis_template.threshold_dsl`. Fails on the first invalid line —
 * callers should surface the error to the gate verdict as Fail with the parse
 * message attached.
 */
export function parse_threshold_dsl(dsl: string): Result<Threshold[], ParseError> {
	const lines = split_lines(dsl);
	const thresholds: Threshold[] = [];
	for (const { line, raw } of lines) {
		const parsed = parse_line(line, raw);
		if (!parsed.ok) return parsed;
		thresholds.push(parsed.value);
	}
	return ok(thresholds);
}

const compare = (actual: number, op: ThresholdOp, expected: number): boolean => {
	switch (op) {
		case ">":
			return actual > expected;
		case "<":
			return actual < expected;
		case ">=":
			return actual >= expected;
		case "<=":
			return actual <= expected;
		case "=":
			return actual === expected;
	}
};

const format_breach = (t: Threshold, actual: number): string => t.reason_template ?? `${t.metric}=${actual} ${t.op} ${t.value}`;

/**
 * Determine whether the analysis window has elapsed.
 * Pure: callers pass `now_ms` from outside.
 */
export const is_window_open = (now_ms: number, started_at_ms: number, window_duration_ms: number): boolean => now_ms - started_at_ms < window_duration_ms;

/**
 * Evaluate a metric snapshot against the parsed thresholds. Pure: returns one
 * of `Pass | Fail | Pending` with a reason string. Pending takes priority over
 * Fail when both apply — pending means "we don't know yet" (insufficient
 * traffic, missing metric, etc.) and the caller should re-check later rather
 * than failing the run outright.
 */
export function evaluate_metrics_against_thresholds(metrics: MetricSnapshot, thresholds: Threshold[]): AnalysisVerdict {
	const pending: Threshold[] = [];
	const fails: Array<{ t: Threshold; actual: number }> = [];

	for (const t of thresholds) {
		const actual = metrics.metrics[t.metric];
		if (actual === undefined) {
			if (t.on_fail === "Pending") {
				pending.push(t);
				continue;
			}
			fails.push({ t, actual: Number.NaN });
			continue;
		}
		if (compare(actual, t.op, t.value)) {
			if (t.on_fail === "Pending") pending.push(t);
			else fails.push({ t, actual });
		}
	}

	if (pending.length > 0) {
		const reasons = pending.map(t => `${t.metric} ${t.op} ${t.value}`).join(", ");
		return { verdict: "Pending", reason: `pending thresholds breached: ${reasons}` };
	}
	if (fails.length > 0) {
		const reasons = fails.map(f => format_breach(f.t, f.actual)).join(", ");
		return { verdict: "Fail", reason: reasons };
	}
	return { verdict: "Pass" };
}

export type SummaryQuery = {
	package: string;
	environment: string;
	version_id: string;
	window_ms: number;
};

/**
 * Build the pulse summary query for a given stage context + template window.
 * Pure construction — no IO. `stage_name` doubles as the pulse `environment`
 * dimension (Phase 2 mapping; tighten in Phase 3 if needed).
 */
export function build_summary_query(template: { window_ms: number }, run: { package: string; version_id: string }, stage: { name: string }): SummaryQuery {
	return {
		package: run.package,
		environment: stage.name,
		version_id: run.version_id,
		window_ms: template.window_ms,
	};
}
