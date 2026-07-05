import type { Result } from "@f0rbit/corpus";

/**
 * Wire shape returned by pulse `GET /summary?package=...&environment=...&version_id=...&window_ms=...`.
 *
 * Defined here (and identically in pulse's core) for Phase 2 — consolidate to a
 * shared types-only package in Phase 3 if drift becomes a problem.
 */
export type MetricSnapshot = {
	metrics: Record<string, number>;
	window_start_ms: number;
	window_end_ms: number;
	sample_count: number;
};

export type PulseSummaryQuery = {
	package: string;
	environment: string;
	version_id: string;
	window_ms: number;
};

export type PulseError =
	| { code: "network"; message: string }
	| { code: "validation"; message: string }
	| { code: "unauthorized"; message: string }
	| { code: "internal"; message: string };

/**
 * Provider port for pulse's per-version summary endpoint. Production wraps the
 * HTTP API; tests inject the in-memory fake.
 */
export interface PulseSummaryProvider {
	fetch(query: PulseSummaryQuery): Promise<Result<MetricSnapshot, PulseError>>;
}
