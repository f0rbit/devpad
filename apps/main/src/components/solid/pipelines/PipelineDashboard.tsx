/**
 * @module components/solid/pipelines/PipelineDashboard
 *
 * Server-rendered dashboard for the pipeline tab (Phase 2.D.3). The Astro
 * page fetches `client.pipelines.dashboard.get({ project_id, window_ms })`
 * and passes the resulting snapshot down as props — this component is
 * stateless apart from the window selector which updates the URL so deep-
 * linking works.
 *
 * Four panels per the plan:
 *
 *  1. Run counts — `Stat` per status, status-coloured borders.
 *  2. Verdict rates — stacked bar (pass / fail / pending) per gate type.
 *  3. Latency — p50 / p95 `Stat`s; render "—" for null (NOT "NaN").
 *  4. Approval turnaround — `Stat` showing p50 in human units.
 *
 * Adversary checklist (per plan):
 *   - Null p50 / p95 render as "—" not "NaN" — see `format_ms`.
 *   - Empty-window state shows `<Empty>` — see `is_empty()`.
 *   - Pulse-null doesn't fail the latency panel — D1-derived p50/p95 still
 *     renders; pulse is best-effort metadata, not a precondition.
 *   - Window selector updates the URL `?window_ms=...` for deep-linking.
 *   - No `any` casts — props use the exact API client return type.
 */

import type { DashboardResponse } from "@devpad/schema/validation";
import { Empty, Stat } from "@f0rbit/ui";
import { For, Show } from "solid-js";

// Pulse summary is a permissive Record because the upstream shape is
// pulse-versioned and we only render it as a thin enrichment ribbon — no
// strong typing required here. Treating it as `Record<string, unknown> | null`
// keeps the dashboard from breaking on pulse upgrades.
type PulseSummary = Record<string, unknown> | null;

export type PipelineDashboardData = DashboardResponse & { pulse: PulseSummary };

export interface PipelineDashboardProps {
	data: PipelineDashboardData;
	project_id: string;
	window_ms: number;
}

const WINDOW_OPTIONS: ReadonlyArray<{ label: string; ms: number }> = [
	{ label: "1h", ms: 60 * 60 * 1000 },
	{ label: "24h", ms: 24 * 60 * 60 * 1000 },
	{ label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
];

// ─── Format helpers ─────────────────────────────────────────────────

/**
 * Render a millisecond duration in human-readable units. Null → "—"
 * (NOT "NaN"). Sub-second values render in ms; sub-minute in seconds;
 * sub-hour in minutes; etc. Designed for at-a-glance reading, not
 * stopwatch precision.
 */
const format_ms = (ms: number | null): string => {
	if (ms === null || !Number.isFinite(ms)) return "—";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
	if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)}h`;
	return `${(ms / (24 * 60 * 60_000)).toFixed(1)}d`;
};

const format_pct = (n: number | null): string => {
	if (n === null || !Number.isFinite(n)) return "—";
	return `${(n * 100).toFixed(1)}%`;
};

const format_int = (n: number): string => n.toLocaleString();

// ─── Empty detection ────────────────────────────────────────────────

const is_empty = (data: PipelineDashboardData): boolean => data.run_counts.total === 0;

// ─── Verdict bar ────────────────────────────────────────────────────

type Verdicts = DashboardResponse["verdict_counts"]["manual"];

const verdict_total = (v: Verdicts): number => v.pass + v.fail + v.pending;

const VERDICT_COLORS = {
	pass: "var(--item-green, #6fcf97)",
	fail: "var(--item-red, #eb5757)",
	pending: "var(--item-yellow, #f2c94c)",
} as const;

const VerdictBar = (props: { label: string; verdicts: Verdicts }) => {
	const total = () => verdict_total(props.verdicts);
	const pct = (n: number): string => {
		const t = total();
		if (t === 0) return "0%";
		return `${(n / t) * 100}%`;
	};

	return (
		<div class="stack stack-xs" style={{ "min-width": "180px", flex: 1 }}>
			<div class="row row-between">
				<span class="text-sm text-faint">{props.label}</span>
				<span class="text-sm text-faint">{total()}</span>
			</div>
			<Show
				when={total() > 0}
				fallback={
					<div style={{ height: "8px", background: "var(--bg-alt, #1a1a1a)", "border-radius": "4px" }} aria-label={`${props.label}: no verdicts`} />
				}
			>
				<div style={{ display: "flex", height: "8px", "border-radius": "4px", overflow: "hidden", background: "var(--bg-alt, #1a1a1a)" }} aria-label={`${props.label}: ${props.verdicts.pass} pass, ${props.verdicts.fail} fail, ${props.verdicts.pending} pending`}>
					<div style={{ width: pct(props.verdicts.pass), background: VERDICT_COLORS.pass }} title={`pass: ${props.verdicts.pass}`} />
					<div style={{ width: pct(props.verdicts.fail), background: VERDICT_COLORS.fail }} title={`fail: ${props.verdicts.fail}`} />
					<div style={{ width: pct(props.verdicts.pending), background: VERDICT_COLORS.pending }} title={`pending: ${props.verdicts.pending}`} />
				</div>
			</Show>
			<div class="row" style={{ gap: "0.75rem" }}>
				<span class="text-xs" style={{ color: VERDICT_COLORS.pass }}>{`pass ${props.verdicts.pass}`}</span>
				<span class="text-xs" style={{ color: VERDICT_COLORS.fail }}>{`fail ${props.verdicts.fail}`}</span>
				<span class="text-xs" style={{ color: VERDICT_COLORS.pending }}>{`pending ${props.verdicts.pending}`}</span>
			</div>
		</div>
	);
};

// ─── Window selector ────────────────────────────────────────────────

const WindowSelector = (props: { project_id: string; current_ms: number }) => {
	const href = (ms: number): string => `/project/${props.project_id}/pipeline?tab=dashboard&window_ms=${ms}`;
	return (
		<nav aria-label="dashboard window" class="row" style={{ gap: "0.5rem" }}>
			<For each={WINDOW_OPTIONS}>
				{opt => (
					<a
						href={href(opt.ms)}
						data-testid={`window-${opt.label}`}
						style={{
							padding: "0.25rem 0.75rem",
							"border-radius": "4px",
							"font-size": "0.85rem",
							"text-decoration": "none",
							background: opt.ms === props.current_ms ? "var(--bg-alt, #1a1a1a)" : "transparent",
							color: opt.ms === props.current_ms ? "var(--fg)" : "var(--fg-muted)",
							border: "1px solid var(--border, #333)",
						}}
					>
						{opt.label}
					</a>
				)}
			</For>
		</nav>
	);
};

// ─── Main component ─────────────────────────────────────────────────

export default function PipelineDashboard(props: PipelineDashboardProps) {
	const data = () => props.data;
	const counts = () => data().run_counts;
	const verdicts = () => data().verdict_counts;

	return (
		<div class="stack stack-md">
			<div class="row row-between" style={{ "align-items": "center" }}>
				<h2 style={{ margin: 0 }}>dashboard</h2>
				<WindowSelector project_id={props.project_id} current_ms={props.window_ms} />
			</div>

			<Show
				when={!is_empty(data())}
				fallback={
					<Empty title="No runs in this window" description="No pipeline activity has been recorded over the selected window. Trigger a run or expand the window to see metrics." />
				}
			>
				{/* Panel 1 — Run counts */}
				<section class="stack stack-sm" aria-labelledby="dashboard-runs-heading">
					<h3 id="dashboard-runs-heading" style={{ margin: 0 }}>run counts</h3>
					<div class="row" style={{ gap: "1.25rem", "flex-wrap": "wrap" }}>
						<Stat value={format_int(counts().total)} label="total" />
						<Stat value={format_int(counts().completed)} label="completed" />
						<Stat value={format_int(counts().in_flight)} label="in flight" />
						<Stat value={format_int(counts().failed)} label="failed" />
						<Stat value={format_int(counts().cancelled)} label="cancelled" />
						<Stat value={format_int(counts().rolled_back)} label="rolled back" />
					</div>
				</section>

				{/* Panel 2 — Verdict rates */}
				<section class="stack stack-sm" aria-labelledby="dashboard-verdicts-heading">
					<h3 id="dashboard-verdicts-heading" style={{ margin: 0 }}>verdict rates</h3>
					<div class="row" style={{ gap: "1.5rem", "flex-wrap": "wrap" }}>
						<VerdictBar label="manual" verdicts={verdicts().manual} />
						<VerdictBar label="auto" verdicts={verdicts().auto} />
						<VerdictBar label="analysis" verdicts={verdicts().analysis} />
					</div>
				</section>

				{/* Panel 3 — Latency */}
				<section class="stack stack-sm" aria-labelledby="dashboard-latency-heading">
					<h3 id="dashboard-latency-heading" style={{ margin: 0 }}>latency (run duration)</h3>
					<div class="row" style={{ gap: "1.25rem", "flex-wrap": "wrap" }}>
						<Stat value={format_ms(data().latency_p50_ms)} label="p50" />
						<Stat value={format_ms(data().latency_p95_ms)} label="p95" />
						<Stat value={format_pct(data().rollback_rate)} label="rollback rate" />
					</div>
				</section>

				{/* Panel 4 — Approval turnaround */}
				<section class="stack stack-sm" aria-labelledby="dashboard-approvals-heading">
					<h3 id="dashboard-approvals-heading" style={{ margin: 0 }}>approval turnaround</h3>
					<div class="row" style={{ gap: "1.25rem", "flex-wrap": "wrap" }}>
						<Stat value={format_ms(data().approval_turnaround_p50_ms)} label="p50" />
					</div>
					<Show when={data().pulse === null}>
						<p class="text-xs text-faint" style={{ margin: 0 }}>
							pulse data unavailable — latency is computed from run duration only.
						</p>
					</Show>
				</section>
			</Show>
		</div>
	);
}
