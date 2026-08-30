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
	/** Culled-out nodes stay mounted (tldraw-style — no mount/unmount churn per
	 * frame) and are hidden with `display:none` instead. */
	readonly visible: boolean;
	readonly onSelect: (id: string) => void;
};

const FOLD_KINDS: ReadonlySet<Task["kind"]> = new Set(["milestone", "goal"]);

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
/**
 * LOD tiers per the UX contract: `map` collapses to a dot/pill (title shown
 * only for fold kinds — milestone/goal — since those are the anchors worth
 * naming even zoomed all the way out), `neighborhood` is a compact
 * icon-only-kind card, `node` is the full card, `detail` is the full card
 * plus a detail panel slot (empty shell here — P3 fills it in). The caller
 * debounces `level` itself while `camera.is_moving()` so this component
 * never has to know about motion.
 */
export default function CanvasNode(props: CanvasNodeProps) {
	const dash = () => (RING_CIRCUMFERENCE * progress_percent(props.task)) / 100;
	const is_map = () => props.level === "map";
	const is_neighborhood = () => props.level === "neighborhood";
	const show_body = () => props.level === "node" || props.level === "detail";
	const show_detail_panel = () => props.level === "detail" && props.selected;

	return (
		<article
			class={`canvas-node ${STATUS_CLASS[props.task.progress]}${props.selected ? " canvas-node-selected" : ""}`}
			classList={{ "canvas-node-detail": show_detail_panel() }}
			data-canvas-node
			data-testid="canvas-node"
			data-task-id={props.task.id}
			data-lod={props.level}
			style={{ left: `${props.x}px`, top: `${props.y}px`, display: props.visible ? undefined : "none" }}
			tabIndex={0}
			aria-label={`${props.task.title}, ${progress_percent(props.task)}% complete`}
			onClick={(e) => {
				e.stopPropagation();
				props.onSelect(props.task.id);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter") props.onSelect(props.task.id);
			}}
		>
			<div class="canvas-node-head">
				<div class="canvas-node-text">
					<Show when={!is_map() || FOLD_KINDS.has(props.task.kind)}>
						<h3 class="canvas-node-title">{props.task.title}</h3>
					</Show>
					<Show when={!is_map()}>
						<div class="canvas-node-kind">
							<KindGlyph kind={props.task.kind} />
							<Show when={!is_neighborhood()}>
								{props.task.kind} · {props.task.progress}
							</Show>
						</div>
					</Show>
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
			<Show when={show_body()}>
				<div class="canvas-node-body">
					<Show when={show_detail_panel()}>
						{/* Empty shell — P3 fills this in with the selected node's detail panel content. */}
						<div class="canvas-node-detail-panel" data-testid="canvas-node-detail-panel" />
					</Show>
				</div>
			</Show>
		</article>
	);
}

const progress_percent = (task: Task): number =>
	task.progress === "COMPLETED" ? 100 : task.progress === "IN_PROGRESS" ? 50 : 0;

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
