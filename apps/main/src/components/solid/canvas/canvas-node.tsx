import type { Task } from "@devpad/schema";
import Milestone from "lucide-solid/icons/milestone";
import Target from "lucide-solid/icons/target";
import { Show } from "solid-js";
import type { CameraLevel } from "./camera";

export type CanvasNodeProps = {
	readonly task: Task;
	readonly x: number;
	readonly y: number;
	readonly level: CameraLevel;
	readonly selected: boolean;
	readonly onSelect: (id: string) => void;
};

const STATUS_CLASS: Record<Task["progress"], string> = {
	UNSTARTED: "canvas-node-unstarted",
	IN_PROGRESS: "canvas-node-doing",
	COMPLETED: "canvas-node-done",
};

const RING_CIRCUMFERENCE = 81.7;

/**
 * Minimal node card for P2.3 — title, status/progress ring, a kind glyph for
 * milestone/goal per the UX contract's `.node_kind` treatment. LOD tiers
 * (map/neighborhood/node/detail body content) land in P2.4; semantic
 * projections land in P3 — this stays a thin, `level`-aware shell so both
 * can slot in without a rewrite.
 */
export default function CanvasNode(props: CanvasNodeProps) {
	const dash = () => (RING_CIRCUMFERENCE * progress_percent(props.task)) / 100;

	return (
		<article
			class={`canvas-node ${STATUS_CLASS[props.task.progress]}${props.selected ? " canvas-node-selected" : ""}`}
			data-canvas-node
			data-testid="canvas-node"
			data-task-id={props.task.id}
			data-lod={props.level}
			style={{ left: `${props.x}px`, top: `${props.y}px` }}
			tabIndex={0}
			aria-label={`${props.task.title}, ${progress_percent(props.task)}% complete`}
			onClick={e => {
				e.stopPropagation();
				props.onSelect(props.task.id);
			}}
			onKeyDown={e => {
				if (e.key === "Enter") props.onSelect(props.task.id);
			}}
		>
			<div class="canvas-node-head">
				<div class="canvas-node-text">
					<h3 class="canvas-node-title">{props.task.title}</h3>
					<div class="canvas-node-kind">
						<KindGlyph kind={props.task.kind} />
						{props.task.kind} · {props.task.progress}
					</div>
				</div>
				<svg class="canvas-ring" viewBox="0 0 32 32" aria-hidden="true">
					<circle class="canvas-ring-track" cx="16" cy="16" r="13" />
					<circle
						class="canvas-ring-value"
						classList={{ "canvas-ring-complete": props.task.progress === "COMPLETED" }}
						cx="16"
						cy="16"
						r="13"
						style={{ "stroke-dashoffset": `${RING_CIRCUMFERENCE - dash()}` }}
					/>
				</svg>
			</div>
		</article>
	);
}

const progress_percent = (task: Task): number => (task.progress === "COMPLETED" ? 100 : task.progress === "IN_PROGRESS" ? 50 : 0);

function KindGlyph(props: { kind: Task["kind"] }) {
	return (
		<>
			<Show when={props.kind === "milestone"}>
				<Milestone class="canvas-kind-glyph" size={11} aria-hidden="true" />
			</Show>
			<Show when={props.kind === "goal"}>
				<Target class="canvas-kind-glyph" size={11} aria-hidden="true" />
			</Show>
		</>
	);
}
