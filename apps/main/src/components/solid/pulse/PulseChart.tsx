import { Show } from "solid-js";

interface PulseChartProps {
	data: number[];
	width?: number;
	height?: number;
	color?: string;
	fill?: boolean;
	"aria-label"?: string;
}

const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 48;

/**
 * Tiny SVG sparkline. No D3, no chart lib. Renders a single path scaled to
 * the provided viewBox; an optional area fill underneath. Empty / single-point
 * data renders a flat baseline.
 */
export default function PulseChart(props: PulseChartProps) {
	const width = () => props.width ?? DEFAULT_WIDTH;
	const height = () => props.height ?? DEFAULT_HEIGHT;
	const color = () => props.color ?? "var(--accent)";

	const points = () => {
		const data = props.data ?? [];
		if (data.length === 0) return [] as Array<[number, number]>;
		const w = width();
		const h = height();
		const max = Math.max(...data, 1);
		const min = Math.min(...data, 0);
		const span = max - min || 1;
		const step = data.length > 1 ? w / (data.length - 1) : 0;
		return data.map((v, i): [number, number] => {
			const x = i * step;
			const y = h - ((v - min) / span) * h;
			return [x, y];
		});
	};

	const linePath = () => {
		const pts = points();
		if (pts.length === 0) return "";
		return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
	};

	const areaPath = () => {
		const pts = points();
		if (pts.length === 0) return "";
		const h = height();
		const head = `M ${pts[0][0].toFixed(2)} ${h}`;
		const body = pts.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
		const tail = `L ${pts[pts.length - 1][0].toFixed(2)} ${h} Z`;
		return `${head} ${body} ${tail}`;
	};

	return (
		<svg
			width={width()}
			height={height()}
			viewBox={`0 0 ${width()} ${height()}`}
			role="img"
			aria-label={props["aria-label"] ?? "sparkline"}
			preserveAspectRatio="none"
		>
			<Show when={points().length === 0}>
				<line
					x1="0"
					y1={height() / 2}
					x2={width()}
					y2={height() / 2}
					stroke="var(--border)"
					stroke-width="1"
					stroke-dasharray="2,2"
				/>
			</Show>
			<Show when={props.fill && points().length > 1}>
				<path d={areaPath()} fill={color()} fill-opacity="0.15" stroke="none" />
			</Show>
			<Show when={points().length > 1}>
				<path
					d={linePath()}
					fill="none"
					stroke={color()}
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</Show>
		</svg>
	);
}
