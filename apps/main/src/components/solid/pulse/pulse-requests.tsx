import { Empty, Stat } from "@f0rbit/ui";
import type { PulseLatencyResult } from "@devpad/api";
import { Show } from "solid-js";
import PulseChart from "./pulse-chart";

type PulseRequestsProps = {
	projectId: string;
	projectSlug: string;
	latency: PulseLatencyResult | null;
	error?: string | null;
};

const fmtMs = (n: number | null | undefined): string => (typeof n === "number" ? `${String(Math.round(n))} ms` : "—");

export default function PulseRequests(props: PulseRequestsProps) {
	const percentiles = () => props.latency?.percentiles ?? {};
	const by_minute = () => props.latency?.by_minute ?? [];

	const seriesValues = (key: "p50" | "p95" | "p99"): number[] =>
		by_minute()
			.map((b) => b[key])
			.filter((v): v is number => typeof v === "number");

	const isEmpty = () => by_minute().length === 0;

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
						title="No request data"
						description="Latency stats appear once your project starts reporting request timings."
					/>
				}
			>
				<div class="row" style={{ gap: "1.25rem", "flex-wrap": "wrap" }}>
					<Stat value={fmtMs(percentiles()["50"])} label="p50" />
					<Stat value={fmtMs(percentiles()["95"])} label="p95" />
					<Stat value={fmtMs(percentiles()["99"])} label="p99" />
				</div>

				<div class="stack stack-sm">
					<h3 style={{ margin: 0 }}>latency over time</h3>
					<div class="row" style={{ gap: "1rem", "flex-wrap": "wrap" }}>
						<div class="stack stack-xs">
							<span class="text-sm text-faint">p50</span>
							<PulseChart
								data={seriesValues("p50")}
								color="var(--item-blue, #4a90e2)"
								fill
								width={240}
								height={56}
								aria-label="p50 latency"
							/>
						</div>
						<div class="stack stack-xs">
							<span class="text-sm text-faint">p95</span>
							<PulseChart
								data={seriesValues("p95")}
								color="var(--item-yellow, #f2c94c)"
								fill
								width={240}
								height={56}
								aria-label="p95 latency"
							/>
						</div>
						<div class="stack stack-xs">
							<span class="text-sm text-faint">p99</span>
							<PulseChart
								data={seriesValues("p99")}
								color="var(--item-red, #eb5757)"
								fill
								width={240}
								height={56}
								aria-label="p99 latency"
							/>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
}
