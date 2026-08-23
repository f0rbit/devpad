import { describe, expect, it } from "bun:test";
import {
	PulseErrorsResultSchema,
	PulseLatencyResultSchema,
	PulseLogsResultSchema,
	PulseSummarySchema,
	pulseSummaryHasData,
} from "../types.js";

// Real pulse `/summary/:project_id?range=7d` response, verified live against
// project_3f0035e0-8530-4542-a087-75a11a419ac3 (see devpad AGENTS.md "Pulse
// Integration → Dashboard"). This is the shape devpad's dashboard was NOT
// reading — it was invented `{totals, series}` instead.
const REAL_SUMMARY_PAYLOAD = {
	pageviews: 94,
	sessions: 18,
	events_total: 107,
	errors: 0,
	request_count: 0,
	p95_latency_ms: null,
	by_day: [{ date: "2026-08-17", pageviews: 14, sessions: 6, errors: 0 }],
};

describe("PulseSummarySchema", () => {
	it("parses pulse's real /summary response shape", () => {
		const parsed = PulseSummarySchema.parse(REAL_SUMMARY_PAYLOAD);
		expect(parsed.pageviews).toBe(94);
		expect(parsed.sessions).toBe(18);
		expect(parsed.by_day).toHaveLength(1);
		expect(parsed.by_day[0]?.date).toBe("2026-08-17");
	});

	it("rejects the invented totals/series shape the dashboard used to read", () => {
		const invented_shape = { totals: { pageviews: 94, errors: 0 }, series: {} };
		expect(PulseSummarySchema.safeParse(invented_shape).success).toBe(false);
	});
});

describe("pulseSummaryHasData", () => {
	it("is true when the real payload carries any non-zero metric", () => {
		expect(pulseSummaryHasData(PulseSummarySchema.parse(REAL_SUMMARY_PAYLOAD))).toBe(true);
	});

	it("is false for null summary", () => {
		expect(pulseSummaryHasData(null)).toBe(false);
	});

	it("is false when every metric is zero", () => {
		const empty = PulseSummarySchema.parse({
			pageviews: 0,
			sessions: 0,
			events_total: 0,
			errors: 0,
			request_count: 0,
			p95_latency_ms: null,
			by_day: [],
		});
		expect(pulseSummaryHasData(empty)).toBe(false);
	});
});

describe("PulseErrorsResultSchema", () => {
	it("parses the grouped-by-fingerprint shape", () => {
		const parsed = PulseErrorsResultSchema.parse({
			issues: [
				{
					fingerprint: "abc123",
					count: 3,
					first_seen: 1000,
					last_seen: 2000,
					sample: {
						id: 1,
						project_id: "p",
						name: "error",
						ts: 2000,
						session_id: "s",
						url: null,
						referrer: null,
						user_agent: null,
						country: null,
						level: "error",
						release: null,
						error_fingerprint: "abc123",
						properties: { "exception.message": "boom" },
					},
				},
			],
		});
		expect("issues" in parsed && parsed.issues[0]?.count).toBe(3);
	});

	it("parses the flat errors shape", () => {
		const parsed = PulseErrorsResultSchema.parse({ errors: [] });
		expect("errors" in parsed).toBe(true);
	});
});

describe("PulseLogsResultSchema and PulseLatencyResultSchema", () => {
	it("parses logs", () => {
		expect(PulseLogsResultSchema.parse({ logs: [] }).logs).toEqual([]);
	});

	it("parses latency", () => {
		const parsed = PulseLatencyResultSchema.parse({
			percentiles: { "50": 12, "95": 40, "99": null },
			by_minute: [{ ts: 1000, p50: 12, p95: 40, p99: null }],
		});
		expect(parsed.percentiles["95"]).toBe(40);
		expect(parsed.by_minute[0]?.p50).toBe(12);
	});
});
