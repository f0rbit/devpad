import { ok, type Result } from "@f0rbit/corpus";
import type { MetricSnapshot, PulseError, PulseSummaryProvider, PulseSummaryQuery } from "./pulse-summary-provider.ts";

const query_key = (q: PulseSummaryQuery): string => `${q.package}|${q.environment}|${q.version_id}`;

export type PulseSummaryCall = {
	query: PulseSummaryQuery;
	at: string;
};

/**
 * In-memory pulse summary provider for tests. Callers seed responses keyed by
 * `(package, environment, version_id)` via {@link set_next_response}; missing
 * keys return an empty snapshot so the gate evaluator can be exercised without
 * pre-seeding every dimension.
 */
export class InMemoryPulseSummaryProvider implements PulseSummaryProvider {
	readonly calls: PulseSummaryCall[] = [];
	private responses = new Map<string, MetricSnapshot>();
	private errors = new Map<string, PulseError>();

	set_next_response(query: Omit<PulseSummaryQuery, "window_ms">, snapshot: MetricSnapshot): void {
		this.responses.set(query_key({ ...query, window_ms: 0 }), snapshot);
	}

	set_next_error(query: Omit<PulseSummaryQuery, "window_ms">, error: PulseError): void {
		this.errors.set(query_key({ ...query, window_ms: 0 }), error);
	}

	async fetch(query: PulseSummaryQuery): Promise<Result<MetricSnapshot, PulseError>> {
		this.calls.push({ query, at: new Date().toISOString() });
		const key = query_key(query);
		const error = this.errors.get(key);
		if (error) return { ok: false, error };
		const seeded = this.responses.get(key);
		if (seeded) return ok(seeded);
		const now = Date.now();
		return ok({
			metrics: {},
			window_start_ms: now - query.window_ms,
			window_end_ms: now,
			sample_count: 0,
		});
	}
}
