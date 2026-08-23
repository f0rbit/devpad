import { Empty, Stat } from "@f0rbit/ui";
import type { PulseSummary } from "@devpad/api";
import { pulseSummaryHasData } from "@devpad/api";
import { For, Show } from "solid-js";
import PulseChart from "./pulse-chart";

type PulseOverviewProps = {
	projectId: string;
	projectSlug: string;
	summary: PulseSummary | null;
	error?: string | null;
};

const SPARKS: Array<{ key: "pageviews" | "sessions" | "errors"; label: string; color: string }> = [
	{ key: "pageviews", label: "pageviews", color: "var(--item-blue, #4a90e2)" },
	{ key: "sessions", label: "sessions", color: "var(--item-green, #6fcf97)" },
	{ key: "errors", label: "errors", color: "var(--item-red, #eb5757)" },
];

const num = (n: number | undefined | null): string => (typeof n === "number" ? n.toLocaleString() : "—");
const ms = (n: number | undefined | null): string => (typeof n === "number" ? `${String(Math.round(n))} ms` : "—");

export default function PulseOverview(props: PulseOverviewProps) {
	const by_day = () => props.summary?.by_day ?? [];

	const seriesValues = (key: "pageviews" | "sessions" | "errors"): number[] => by_day().map((d) => d[key]);

	return (
		<div class="stack stack-md">
			<Show when={props.error}>
				<p class="text-sm" style={{ color: "var(--item-red)", margin: 0 }}>
					{props.error}
				</p>
			</Show>

			<Show
				when={pulseSummaryHasData(props.summary)}
				fallback={
					<Empty
						title="No analytics data yet"
						description="Once your project starts emitting events, summary stats will appear here."
					/>
				}
			>
				<div class="row" style={{ gap: "1.25rem", "flex-wrap": "wrap" }}>
					<Stat value={num(props.summary?.pageviews)} label="pageviews" />
					<Stat value={num(props.summary?.sessions)} label="sessions" />
					<Stat value={num(props.summary?.events_total)} label="events" />
					<Stat value={num(props.summary?.errors)} label="errors" />
					<Stat value={num(props.summary?.request_count)} label="requests" />
					<Stat value={ms(props.summary?.p95_latency_ms)} label="p95 latency" />
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
