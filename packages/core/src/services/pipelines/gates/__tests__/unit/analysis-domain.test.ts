import { describe, expect, test } from "bun:test";
import { build_summary_query, evaluate_metrics_against_thresholds, is_window_open, type MetricSnapshot, parse_threshold_dsl, type Threshold } from "../../analysis-domain.js";

describe("parse_threshold_dsl", () => {
	test("parses a single threshold", () => {
		const result = parse_threshold_dsl("error_rate > 0.01");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([{ metric: "error_rate", op: ">", value: 0.01, on_fail: "Fail" }]);
		}
	});

	test("parses multi-line + comments + blanks", () => {
		const dsl = `
# error budget
error_rate > 0.01
p99_latency_ms > 500

# below this is "we don't know yet"
request_rate < 10 : pending
`;
		const result = parse_threshold_dsl(dsl);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toHaveLength(3);
			expect(result.value[2]).toEqual({ metric: "request_rate", op: "<", value: 10, on_fail: "Pending" });
		}
	});

	test("rejects missing operator", () => {
		const result = parse_threshold_dsl("error_rate 0.01");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("parse_error");
			expect(result.error.message).toContain("no comparison operator");
		}
	});

	test("rejects empty metric name", () => {
		const result = parse_threshold_dsl("> 0.01");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("empty metric name");
	});

	test("rejects non-numeric value", () => {
		const result = parse_threshold_dsl("error_rate > nope");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("not a finite number");
	});

	test("reports the offending line number", () => {
		const dsl = "error_rate > 0.01\nrequest_rate ?? 10";
		const result = parse_threshold_dsl(dsl);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.line).toBe(2);
	});
});

describe("is_window_open", () => {
	test("returns true while elapsed < window", () => {
		expect(is_window_open(1500, 1000, 600)).toBe(true);
	});

	test("returns false at exact boundary", () => {
		expect(is_window_open(1600, 1000, 600)).toBe(false);
	});

	test("returns false when elapsed > window", () => {
		expect(is_window_open(2000, 1000, 600)).toBe(false);
	});

	test("treats window_ms=0 as immediately closed", () => {
		expect(is_window_open(1000, 1000, 0)).toBe(false);
	});
});

describe("build_summary_query", () => {
	test("composes pulse query from template + run + stage", () => {
		const q = build_summary_query({ window_ms: 600_000 }, { package: "pkg-x", version_id: "v_123" }, { name: "wave1" });
		expect(q).toEqual({
			package: "pkg-x",
			environment: "wave1",
			version_id: "v_123",
			window_ms: 600_000,
		});
	});
});

describe("evaluate_metrics_against_thresholds", () => {
	const snapshot = (metrics: Record<string, number>): MetricSnapshot => ({
		metrics,
		window_start_ms: 0,
		window_end_ms: 600_000,
		sample_count: 100,
	});

	const t = (overrides: Partial<Threshold>): Threshold => ({
		metric: "error_rate",
		op: ">",
		value: 0.01,
		on_fail: "Fail",
		...overrides,
	});

	test("window_passed_threshold_met → Pass", () => {
		const result = evaluate_metrics_against_thresholds(snapshot({ error_rate: 0.001 }), [t({})]);
		expect(result.verdict).toBe("Pass");
	});

	test("window_passed_threshold_missed → Fail with metric in reason", () => {
		const result = evaluate_metrics_against_thresholds(snapshot({ error_rate: 0.05 }), [t({})]);
		expect(result.verdict).toBe("Fail");
		if (result.verdict === "Fail") expect(result.reason).toContain("error_rate=0.05");
	});

	test("multiple thresholds mixed — one fails → Fail", () => {
		const thresholds = [t({ metric: "error_rate", value: 0.01 }), t({ metric: "p99_latency_ms", op: ">", value: 500 })];
		const result = evaluate_metrics_against_thresholds(snapshot({ error_rate: 0.005, p99_latency_ms: 1200 }), thresholds);
		expect(result.verdict).toBe("Fail");
		if (result.verdict === "Fail") expect(result.reason).toContain("p99_latency_ms");
	});

	test("multiple thresholds all met → Pass", () => {
		const thresholds = [t({ metric: "error_rate", value: 0.01 }), t({ metric: "p99_latency_ms", op: ">", value: 500 })];
		const result = evaluate_metrics_against_thresholds(snapshot({ error_rate: 0.005, p99_latency_ms: 200 }), thresholds);
		expect(result.verdict).toBe("Pass");
	});

	test("zero-traffic — pending threshold breached → Pending", () => {
		const thresholds = [t({ metric: "request_rate", op: "<", value: 10, on_fail: "Pending" })];
		const result = evaluate_metrics_against_thresholds(snapshot({ request_rate: 0 }), thresholds);
		expect(result.verdict).toBe("Pending");
		if (result.verdict === "Pending") expect(result.reason).toContain("request_rate");
	});

	test("missing metric with on_fail=Pending → Pending", () => {
		const thresholds = [t({ metric: "request_rate", op: "<", value: 10, on_fail: "Pending" })];
		const result = evaluate_metrics_against_thresholds(snapshot({}), thresholds);
		expect(result.verdict).toBe("Pending");
	});

	test("missing metric with on_fail=Fail → Fail", () => {
		const thresholds = [t({ metric: "absent_metric" })];
		const result = evaluate_metrics_against_thresholds(snapshot({}), thresholds);
		expect(result.verdict).toBe("Fail");
	});

	test("Pending takes priority over Fail when both apply", () => {
		const thresholds = [t({ metric: "error_rate", value: 0.01 }), t({ metric: "request_rate", op: "<", value: 10, on_fail: "Pending" })];
		const result = evaluate_metrics_against_thresholds(snapshot({ error_rate: 0.5, request_rate: 0 }), thresholds);
		expect(result.verdict).toBe("Pending");
	});

	test("empty thresholds → Pass (vacuous truth)", () => {
		const result = evaluate_metrics_against_thresholds(snapshot({}), []);
		expect(result.verdict).toBe("Pass");
	});

	test("supports all comparison operators", () => {
		const cases: Array<{ op: Threshold["op"]; metric: number; value: number; breaches: boolean }> = [
			{ op: ">", metric: 2, value: 1, breaches: true },
			{ op: "<", metric: 1, value: 2, breaches: true },
			{ op: ">=", metric: 2, value: 2, breaches: true },
			{ op: "<=", metric: 2, value: 2, breaches: true },
			{ op: "=", metric: 2, value: 2, breaches: true },
			{ op: "=", metric: 2, value: 3, breaches: false },
		];
		for (const c of cases) {
			const result = evaluate_metrics_against_thresholds(snapshot({ m: c.metric }), [t({ metric: "m", op: c.op, value: c.value })]);
			expect(result.verdict).toBe(c.breaches ? "Fail" : "Pass");
		}
	});
});
