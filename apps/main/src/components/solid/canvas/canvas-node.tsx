import type { SdlcStage, Task } from "@devpad/schema";
import Bot from "lucide-solid/icons/bot";
import FileText from "lucide-solid/icons/file-text";
import Milestone from "lucide-solid/icons/milestone";
import Pin from "lucide-solid/icons/pin";
import Target from "lucide-solid/icons/target";
import Watch from "lucide-solid/icons/watch";
import { Show } from "solid-js";
import type { CameraLevel } from "./camera";
import type { NodeProjection } from "./projections";

export type CanvasNodeProps = {
	readonly task: Task;
	readonly x: number;
	readonly y: number;
	readonly level: CameraLevel;
	readonly selected: boolean;
	/** Culled-out nodes stay mounted (tldraw-style — no mount/unmount churn per
	 * frame) and are hidden with `display:none` instead. */
	readonly visible: boolean;
	readonly pinned: boolean;
	/** Agent-created (`created_by === "api"`) AND unpinned — got the default beside-parent placement. */
	readonly programmatic: boolean;
	/** True for one render pass right after an agent-created node first enters view — drives the `.canvas-node-cue` flash. */
	readonly showPlacementCue: boolean;
	/** Lazily fetched only for visible node/detail-LOD nodes (see `projections.ts`) — null until loaded, undefined if never requested. */
	readonly projection: NodeProjection | null | undefined;
	readonly onSelect: (id: string) => void;
	readonly onPointerDownNode: (id: string, event: PointerEvent) => void;
};

const FOLD_KINDS: ReadonlySet<Task["kind"]> = new Set(["milestone", "goal"]);

const STATUS_CLASS: Record<Task["progress"], string> = {
	UNSTARTED: "canvas-node-unstarted",
	IN_PROGRESS: "canvas-node-doing",
	COMPLETED: "canvas-node-done",
};

const STAGE_LABEL: Record<SdlcStage, string> = {
	ideate: "ideate",
	plan: "plan",
	build: "build",
	review: "review",
	deploy: "deploy",
	live: "live",
};

const RING_CIRCUMFERENCE = 81.7;

/**
 * Node card — LOD tiers per the UX contract: `map` collapses to a dot/pill
 * (title shown only for fold kinds), `neighborhood` is icon-only,
 * `node`/`detail` show the full card. `detail` additionally shows a detail
 * panel when selected (P3.2). Projection chips (pin/agent/waiting/docs) are
 * fed from already-loaded graph data (pin/agent) or the lazily-batched
 * `projection` prop (waiting/docs/pulse) — never fetched per-node.
 */
export default function CanvasNode(props: CanvasNodeProps) {
	const dash = () => (RING_CIRCUMFERENCE * progress_percent(props.task)) / 100;
	const is_map = () => props.level === "map";
	const is_neighborhood = () => props.level === "neighborhood";
	const show_body = () => props.level === "node" || props.level === "detail";
	const show_detail_panel = () => props.level === "detail" && props.selected;
	const is_fold = () => FOLD_KINDS.has(props.task.kind);

	return (
		<article
			class={`canvas-node ${STATUS_CLASS[props.task.progress]}${props.selected ? " canvas-node-selected" : ""}${is_fold() ? " canvas-node-fold" : ""}`}
			classList={{
				"canvas-node-detail": show_detail_panel(),
				"canvas-node-pinned": props.pinned,
				"canvas-node-programmatic": props.programmatic,
				"canvas-node-cue": props.showPlacementCue,
			}}
			data-canvas-node
			data-testid="canvas-node"
			data-task-id={props.task.id}
			data-lod={props.level}
			data-pinned={props.pinned ? "true" : "false"}
			data-programmatic={props.programmatic ? "true" : "false"}
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
			onPointerDown={(e) => {
				props.onPointerDownNode(props.task.id, e);
			}}
		>
			<div class="canvas-node-head">
				<div class="canvas-node-text">
					<Show when={!is_map() || is_fold()}>
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
					<div class="canvas-node-chips" data-testid="canvas-node-chips">
						<Show when={props.task.stage}>
							{(stage) => <span class="canvas-chip canvas-chip-stage">{STAGE_LABEL[stage()]}</span>}
						</Show>
						<Show when={props.projection?.waiting}>
							<span class="canvas-chip canvas-chip-waiting" data-testid="canvas-chip-waiting">
								<Watch size={10} aria-hidden="true" />
								waiting on you
							</span>
						</Show>
						<Show when={props.projection?.docsStatus}>
							{(status) => (
								<span class="canvas-chip canvas-chip-docs" data-testid="canvas-chip-docs">
									<FileText size={10} aria-hidden="true" />
									{status()}
								</span>
							)}
						</Show>
						<Show when={props.pinned}>
							<span class="canvas-chip canvas-chip-pin" data-testid="canvas-chip-pin">
								<Pin size={10} aria-hidden="true" />
								pinned
							</span>
						</Show>
						<Show when={props.programmatic}>
							<span class="canvas-chip canvas-chip-agent" data-testid="canvas-chip-agent">
								<Bot size={10} aria-hidden="true" />
								agent-created
							</span>
						</Show>
					</div>
					<Show when={show_detail_panel()}>
						<div class="canvas-node-detail-panel" data-testid="canvas-node-detail-panel">
							<Show when={props.projection?.pulseSpark && props.projection.pulseSpark.length > 0}>
								<Sparkline values={props.projection?.pulseSpark ?? []} />
							</Show>
							<Show when={props.task.description}>
								<p class="canvas-node-detail-desc">{props.task.description}</p>
							</Show>
						</div>
					</Show>
				</div>
			</Show>
		</article>
	);
}

function Sparkline(props: { values: number[] }) {
	const max = () => Math.max(1, ...props.values);
	const points = () =>
		props.values
			.map((v, i) => {
				const x = (i / Math.max(1, props.values.length - 1)) * 100;
				const y = 100 - (v / max()) * 100;
				return `${String(x)},${String(y)}`;
			})
			.join(" ");

	return (
		<svg
			class="canvas-node-sparkline"
			data-testid="canvas-node-sparkline"
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<polyline points={points()} fill="none" stroke="currentColor" stroke-width="4" />
		</svg>
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
