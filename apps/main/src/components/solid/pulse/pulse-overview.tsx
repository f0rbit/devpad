import { Empty, Stat } from "@f0rbit/ui";
import { For, Show } from "solid-js";
import PulseChart from "./pulse-chart";

interface SeriesPoint {
	t: number;
	count: number;
}

interface SummarySeries {
	pageviews?: SeriesPoint[];
	errors?: SeriesPoint[];
	logs?: SeriesPoint[];
	requests?: SeriesPoint[];
}

interface SummaryTotals {
	pageviews?: number;
	errors?: number;
	logs?: number;
	requests?: number;
	unique_visitors?: number;
}

export interface PulseSummary {
	totals?: SummaryTotals;
	series?: SummarySeries;
	range?: { from: number; to: number };
}

interface PulseOverviewProps {
	projectId: string;
	projectSlug: string;
	summary: PulseSummary | null;
	error?: string | null;
}

const SPARKS: Array<{ key: keyof SummarySeries; label: string; color: string }> = [
	{ key: "pageviews", label: "pageviews", color: "var(--item-blue, #4a90e2)" },
	{ key: "requests", label: "requests", color: "var(--item-green, #6fcf97)" },
	{ key: "errors", label: "errors", color: "var(--item-red, #eb5757)" },
	{ key: "logs", label: "logs", color: "var(--item-yellow, #f2c94c)" },
];

const num = (n: number | undefined): string => (typeof n === "number" ? n.toLocaleString() : "—");

export default function PulseOverview(props: PulseOverviewProps) {
	const totals = () => props.summary?.totals ?? {};
	const series = () => props.summary?.series ?? {};

	const seriesValues = (key: keyof SummarySeries): number[] => {
		const s = series()[key];
		return Array.isArray(s) ? s.map((p) => p.count) : [];
	};

	const isEmpty = () => {
		if (!props.summary) return true;
		const t = totals();
		return !(t.pageviews || t.errors || t.logs || t.requests);
	};

	return (
		<div class="stack stack-md">
			<Show when={props.error}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: 0 }}>
					{props.error}
				</p>
			</Show>

			<Show
				when={!isEmpty()}
				fallback={
					<Empty
						title="No analytics data yet"
						description="Once your project starts emitting events, summary stats will appear here."
					/>
				}
			>
				<div class="row" style={{ gap: "1.25rem", "flex-wrap": "wrap" }}>
					<Stat value={num(totals().pageviews)} label="pageviews" />
					<Stat value={num(totals().unique_visitors)} label="unique visitors" />
					<Stat value={num(totals().requests)} label="requests" />
					<Stat value={num(totals().errors)} label="errors" />
					<Stat value={num(totals().logs)} label="log events" />
				</div>

				<div class="stack stack-sm">
					<h3 style={{ margin: 0 }}>last 7 days</h3>
					<div class="row" style={{ gap: "1rem", "flex-wrap": "wrap" }}>
						<For each={SPARKS}>
							{(spark) => (
								<div class="stack stack-xs" style={{ "min-width": "200px" }}>
									<span class="text-sm text-faint">{spark.label}</span>
									<PulseChart
										data={seriesValues(spark.key)}
										color={spark.color}
										fill
										width={220}
										height={48}
										aria-label={`${spark.label} sparkline`}
									/>
								</div>
							)}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
}
