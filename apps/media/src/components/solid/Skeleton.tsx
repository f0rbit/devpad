import { For, type JSX } from "solid-js";

type SkeletonProps = {
	width?: string;
	height?: string;
	class?: string;
	style?: JSX.CSSProperties;
};

export function Skeleton(props: SkeletonProps) {
	return (
		<div
			class={`skeleton ${props.class ?? ""}`}
			style={{
				width: props.width ?? "100%",
				height: props.height ?? "1rem",
				...props.style,
			}}
		/>
	);
}

type SkeletonTextProps = {
	lines?: number;
	class?: string;
};

export function SkeletonText(props: SkeletonTextProps) {
	const lines = () => props.lines ?? 3;
	const widths = ["100%", "90%", "95%", "80%", "85%"];

	return (
		<div class={`skeleton-text ${props.class ?? ""}`}>
			<For each={Array.from({ length: lines() })}>{(_, i) => <Skeleton height="0.875rem" width={widths[i() % widths.length]} />}</For>
		</div>
	);
}

type SkeletonCardProps = {
	class?: string;
};

export function SkeletonCard(props: SkeletonCardProps) {
	return (
		<div class={`skeleton-card ${props.class ?? ""}`}>
			<div class="skeleton-card-header">
				<Skeleton width="60%" height="1.25rem" />
				<Skeleton width="40%" height="0.875rem" />
			</div>
			<div class="skeleton-card-body">
				<SkeletonText lines={2} />
			</div>
		</div>
	);
}
