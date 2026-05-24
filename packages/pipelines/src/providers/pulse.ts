/**
 * @module pipelines/providers/pulse
 *
 * Production wrappers around the pulse service binding.
 *
 * - {@link make_pulse_emitter} — HTTP `POST /ingest` for one-shot events
 *   (gate verdicts, manual-pending notifications). Matches the
 *   {@link PulseEmitter} interface in `@devpad/core`.
 * - {@link make_pulse_summary_client} — HTTP `GET /summary?...` returning
 *   the rolled-up metrics snapshot used by analysis gates. Matches the
 *   {@link PulseSummaryProvider} interface in `@devpad/pipeline-fakes`.
 *
 * Both wrap an `env.PULSE` `Fetcher` so the same code paths work in
 * miniflare / production. No retries here — the gate evaluators decide
 * what failure means.
 */

import type { Fetcher } from "@cloudflare/workers-types";
import { err, ok, type Result } from "@f0rbit/corpus";
import type { EmitError, PulseEmitter, PulseEvent } from "@devpad/core/services/pipelines/gates";
import type { MetricSnapshot, PulseSummaryError as PulseError, PulseSummaryProvider, PulseSummaryQuery } from "@devpad/pipeline-fakes";

const PULSE_HOST = "https://pulse.local";

/**
 * Build a {@link PulseEmitter} backed by the orchestrator's `env.PULSE`
 * service binding. Returns `emit_error` on any non-2xx or network
 * failure — the gate evaluator's caller decides whether to fail-open or
 * fail-closed.
 */
export const make_pulse_emitter = (pulse: Fetcher): PulseEmitter => ({
	emit: async (event: PulseEvent): Promise<Result<void, EmitError>> => {
		try {
			const response = await pulse.fetch(`${PULSE_HOST}/ingest`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(event),
			});
			if (response.status >= 400) {
				const text = await response.text().catch(() => "");
				return err({ kind: "emit_error", message: `pulse ingest ${response.status}: ${text}` });
			}
			return ok(undefined);
		} catch (e) {
			return err({ kind: "emit_error", message: `pulse fetch failed: ${String(e)}` });
		}
	},
});

type PulseSummaryResponse = {
	metrics?: Record<string, number>;
	window_start_ms?: number;
	window_end_ms?: number;
	sample_count?: number;
};

/**
 * Build a {@link PulseSummaryProvider} backed by `env.PULSE`. Used by the
 * analysis gate evaluator to fetch the per-version metric snapshot
 * before deciding pass/fail.
 */
export const make_pulse_summary_client = (pulse: Fetcher): PulseSummaryProvider => ({
	fetch: async (query: PulseSummaryQuery): Promise<Result<MetricSnapshot, PulseError>> => {
		const params = new URLSearchParams({
			package: query.package,
			environment: query.environment,
			version_id: query.version_id,
			window_ms: String(query.window_ms),
		});
		const url = `${PULSE_HOST}/summary?${params.toString()}`;
		try {
			const response = await pulse.fetch(url, { method: "GET" });
			if (response.status === 401) return err({ code: "unauthorized", message: "pulse summary 401" });
			if (response.status === 400) {
				const text = await response.text().catch(() => "");
				return err({ code: "validation", message: text || "pulse summary 400" });
			}
			if (response.status >= 400) {
				const text = await response.text().catch(() => "");
				return err({ code: "internal", message: text || `pulse summary ${response.status}` });
			}
			const body = (await response.json().catch(() => null)) as PulseSummaryResponse | null;
			if (body === null) return err({ code: "internal", message: "pulse summary returned non-json" });
			const now = Date.now();
			return ok({
				metrics: body.metrics ?? {},
				window_start_ms: body.window_start_ms ?? now - query.window_ms,
				window_end_ms: body.window_end_ms ?? now,
				sample_count: body.sample_count ?? 0,
			});
		} catch (e) {
			return err({ code: "network", message: `pulse summary fetch failed: ${String(e)}` });
		}
	},
});
