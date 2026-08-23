import type { PulseSummary } from "@devpad/api";
import { Show } from "solid-js";
import PulseChart from "../pulse/pulse-chart";

type PulseWidgetProps = {
	projectSlug: string;
	summary: PulseSummary | null;
	error?: string | null;
};

const num = (n: number | undefined | null): string => (typeof n === "number" ? n.toLocaleString() : "0");

export default function PulseWidget(props: PulseWidgetProps) {
	const pageviewSeries = (): number[] => (props.summary?.by_day ?? []).map((d) => d.pageviews);

	const href = `/project/${props.projectSlug}/pulse`;

	const isUnreachable = () => props.error === "pulse_unreachable";

	return (
		<a
			href={href}
			class="interactive-row"
			style={{
				display: "block",
				padding: "0.75rem 1rem",
				border: "1px solid var(--border)",
				"border-radius": "var(--radius, 4px)",
				"text-decoration": "none",
				color: "inherit",
			}}
			data-testid="pulse-widget"
		>
			<div class="row row-between" style={{ "align-items": "center", "margin-bottom": "0.5rem" }}>
				<span style={{ "font-weight": 500 }}>pulse</span>
				<span class="text-sm text-faint">last 7 days</span>
			</div>
			<Show
				when={!isUnreachable()}
				fallback={
					<p class="text-sm text-faint" style={{ margin: 0 }}>
						analytics offline
					</p>
				}
			>
				<div class="row" style={{ gap: "1rem", "align-items": "center" }}>
					<div class="stack stack-xs">
						<span class="text-sm text-faint">pageviews</span>
						<span style={{ "font-size": "1.25rem", "font-weight": 600 }}>{num(props.summary?.pageviews)}</span>
					</div>
					<div class="stack stack-xs">
						<span class="text-sm text-faint">errors</span>
						<span
							style={{
								"font-size": "1.25rem",
								"font-weight": 600,
								color: (props.summary?.errors ?? 0) > 0 ? "var(--item-red)" : undefined,
							}}
						>
							{num(props.summary?.errors)}
						</span>
					</div>
					<div style={{ "margin-left": "auto" }}>
						<PulseChart
							data={pageviewSeries()}
							color="var(--accent)"
							fill
							width={140}
							height={36}
							aria-label="7-day pageviews"
						/>
					</div>
				</div>
			</Show>
		</a>
	);
}
