import type { Result } from "@f0rbit/corpus";

/**
 * Managed shape fed to the analysis gate evaluator. Production builds it by
 * reading pulse's real query route and aggregating client-side — see
 * `packages/pipelines/src/providers/pulse.ts`.
 *
 * Wire reality (f0rbit/pulse): `GET /summary/:project_id` only accepts a
 * `range` param and CANNOT filter by package/environment/version_id. The
 * faithful query is `GET /events/:project_id?ts_from=&ts_to=&limit=` with the
 * per-event dimensions matched from `properties` client-side.
 */
export type MetricSnapshot = {
	metrics: Record<string, number>;
	window_start_ms: number;
	window_end_ms: number;
	sample_count: number;
};

/**
 * Gate-side summary query. `environment` is the stage name (see
 * `build_summary_query` in `@devpad/core/services/pipelines/gates`), matched
 * against each pulse event's `properties.environment`.
 */
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
	| { code: "internal"; message: string }
	// #158: the orchestrator's pulse config (project id / read key) is
	// unbound. Observability must not block deploys — analysis gates keep
	// their documented fail-open-with-reason behaviour on this code.
	| { code: "not_configured"; message: string };

/**
 * Provider port for pulse's per-version metric reads. Production wraps the
 * HTTP API (events read-back aggregation); tests inject the in-memory fake.
 */
export type PulseSummaryProvider = {
	fetch(query: PulseSummaryQuery): Promise<Result<MetricSnapshot, PulseError>>;
};
