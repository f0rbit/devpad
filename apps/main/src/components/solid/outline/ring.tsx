import type { RollupCounts } from "./types";

type RingProps = {
	rollup: RollupCounts | undefined;
	size: number;
	auto: boolean;
	rippling: boolean;
};

/** Progress ring for a parent row — the subtree fraction from the rollup cache, never recounted client-side. */
export function Ring(props: RingProps) {
	const frac = () => {
		const r = props.rollup;
		return r && r.subtree_total > 0 ? r.subtree_done / r.subtree_total : 0;
	};
	const radius = () => (props.size - 5) / 2;
	const circumference = () => 2 * Math.PI * radius();
	const center = () => props.size / 2;
	const full = () => frac() === 1;

	return (
		<span class={`outline-ringwrap${props.rippling ? " outline-ripple" : ""}`}>
			<svg
				width={props.size}
				height={props.size}
				viewBox={`0 0 ${String(props.size)} ${String(props.size)}`}
				class={full() ? "outline-ring-full" : ""}
			>
				<circle
					cx={center()}
					cy={center()}
					r={radius()}
					fill="none"
					stroke="var(--outline-ring-track)"
					stroke-width="2.6"
				/>
				<circle
					cx={center()}
					cy={center()}
					r={radius()}
					fill="none"
					stroke={full() ? "var(--success-fg)" : "var(--accent)"}
					stroke-width="2.6"
					stroke-linecap="round"
					stroke-dasharray={`${String(frac() * circumference())} ${String(circumference())}`}
					transform={`rotate(-90 ${String(center())} ${String(center())})`}
				/>
			</svg>
			{props.auto && <span class="outline-ring-auto-dot" />}
		</span>
	);
}
