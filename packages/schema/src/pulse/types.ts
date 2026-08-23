import { z } from "zod";

/**
 * Response shapes for pulse's read API (`GET /summary`, `/errors`, `/logs`,
 * `/latency`, `/events` under `/v1/pulse/*`). Source of truth is pulse's own
 * `packages/core/src/query.ts` — these schemas mirror it so devpad validates
 * at the network boundary instead of trusting `unknown`. Keep in sync by hand;
 * pulse has no published schema package to import from.
 */

export const PulseEventRowSchema = z.object({
	id: z.number(),
	project_id: z.string(),
	name: z.string(),
	ts: z.number(),
	session_id: z.string(),
	url: z.string().nullable(),
	referrer: z.string().nullable(),
	user_agent: z.string().nullable(),
	country: z.string().nullable(),
	level: z.string().nullable(),
	release: z.string().nullable(),
	error_fingerprint: z.string().nullable(),
	properties: z.record(z.string(), z.unknown()).nullable(),
});

export const PulseSummaryByDaySchema = z.object({
	date: z.string(),
	pageviews: z.number(),
	sessions: z.number(),
	errors: z.number(),
});

export const PulseSummarySchema = z.object({
	pageviews: z.number(),
	sessions: z.number(),
	events_total: z.number(),
	errors: z.number(),
	request_count: z.number(),
	p95_latency_ms: z.number().nullable(),
	by_day: z.array(PulseSummaryByDaySchema),
});

export const PulseEventsPageSchema = z.object({
	events: z.array(PulseEventRowSchema),
	next_cursor: z.string().optional(),
});

export const PulseErrorIssueSchema = z.object({
	fingerprint: z.string(),
	count: z.number(),
	first_seen: z.number(),
	last_seen: z.number(),
	sample: PulseEventRowSchema,
});

export const PulseErrorsResultSchema = z.union([
	z.object({ issues: z.array(PulseErrorIssueSchema) }),
	z.object({ errors: z.array(PulseEventRowSchema) }),
]);

export const PulseLogsResultSchema = z.object({
	logs: z.array(PulseEventRowSchema),
});

export const PulseLatencyByMinuteSchema = z.object({
	ts: z.number(),
	p50: z.number().nullable(),
	p95: z.number().nullable(),
	p99: z.number().nullable(),
});

export const PulseLatencyResultSchema = z.object({
	percentiles: z.record(z.string(), z.number().nullable()),
	by_minute: z.array(PulseLatencyByMinuteSchema),
});

export type PulseEventRow = z.infer<typeof PulseEventRowSchema>;
export type PulseSummaryByDay = z.infer<typeof PulseSummaryByDaySchema>;
export type PulseSummary = z.infer<typeof PulseSummarySchema>;
export type PulseEventsPage = z.infer<typeof PulseEventsPageSchema>;
export type PulseErrorIssue = z.infer<typeof PulseErrorIssueSchema>;
export type PulseErrorsResult = z.infer<typeof PulseErrorsResultSchema>;
export type PulseLogsResult = z.infer<typeof PulseLogsResultSchema>;
export type PulseLatencyByMinute = z.infer<typeof PulseLatencyByMinuteSchema>;
export type PulseLatencyResult = z.infer<typeof PulseLatencyResultSchema>;

/** True when the summary carries no meaningful data — drives the "no analytics data yet" empty state. */
export const pulseSummaryHasData = (summary: PulseSummary | null | undefined): boolean =>
	Boolean(summary && (summary.pageviews || summary.sessions || summary.events_total || summary.errors || summary.request_count));
