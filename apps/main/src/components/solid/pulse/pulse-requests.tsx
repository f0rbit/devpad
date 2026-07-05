import { Empty, Stat } from "@f0rbit/ui";
import { For, Show } from "solid-js";
import PulseChart from "./pulse-chart";

interface RoutePerf {
	route?: string;
	count?: number;
	p50?: number;
	p95?: number;
	p99?: number;
	avg?: number;
}

interface SeriesPoint {
	t: number;
	value: number;
}

export interface LatencyData {
	overall?: { p50?: number; p95?: number; p99?: number; avg?: number; count?: number };
	series?: { p50?: SeriesPoint[]; p95?: SeriesPoint[]; p99?: SeriesPoint[] };
	routes?: RoutePerf[];
}

interface PulseRequestsProps {
	projectId: string;
	projectSlug: string;
	latency: LatencyData | null;
	error?: string | null;
}

const fmtMs = (n: number | undefined): string => (typeof n === "number" ? `${String(Math.round(n))} ms` : "—");

export default function PulseRequests(props: PulseRequestsProps) {
	const overall = () => props.latency?.overall ?? {};
	const series = () => props.latency?.series ?? {};
	const routes = () => props.latency?.routes ?? [];

	const seriesValues = (key: "p50" | "p95" | "p99"): number[] => {
		const s = series()[key];
		return Array.isArray(s) ? s.map((p) => p.value) : [];
	};

	const isEmpty = () => routes().length === 0 && !overall().count;

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
					<Stat value={(overall().count ?? 0).toLocaleString()} label="requests" />
					<Stat value={fmtMs(overall().p50)} label="p50" />
					<Stat value={fmtMs(overall().p95)} label="p95" />
					<Stat value={fmtMs(overall().p99)} label="p99" />
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

				<Show when={routes().length > 0}>
					<div class="stack stack-sm">
						<h3 style={{ margin: 0 }}>slowest routes</h3>
						<div class="stack stack-xs" data-testid="pulse-routes-list">
							<For each={routes().slice(0, 10)}>
								{(route) => (
									<div
										class="row row-between"
										style={{
											"align-items": "center",
											gap: "0.5rem",
											padding: "0.5rem 0.75rem",
											border: "1px solid var(--border)",
											"border-radius": "var(--radius, 4px)",
										}}
									>
										<span
											class="text-sm"
											style={{
												"font-family": "var(--font-mono, monospace)",
												"min-width": 0,
												overflow: "hidden",
												"text-overflow": "ellipsis",
												"white-space": "nowrap",
												flex: 1,
											}}
										>
											{route.route ?? "(unknown)"}
										</span>
										<div class="row" style={{ gap: "1rem", "flex-shrink": 0 }}>
											<span class="text-sm text-faint">{(route.count ?? 0).toLocaleString()} req</span>
											<span class="text-sm">p95 {fmtMs(route.p95)}</span>
										</div>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>
			</Show>
		</div>
	);
}
