import type { SdlcStage, Task } from "@devpad/schema";
import Bot from "lucide-solid/icons/bot";
import Check from "lucide-solid/icons/check";
import CircleDashed from "lucide-solid/icons/circle-dashed";
import CircleDot from "lucide-solid/icons/circle-dot";
import FileText from "lucide-solid/icons/file-text";
import Lock from "lucide-solid/icons/lock";
import Milestone from "lucide-solid/icons/milestone";
import Pin from "lucide-solid/icons/pin";
import Target from "lucide-solid/icons/target";
import Watch from "lucide-solid/icons/watch";
import Zap from "lucide-solid/icons/zap";
import { Show } from "solid-js";
import type { CameraLevel } from "./camera";
import { FOLD_KINDS, node_size_for } from "./layout";
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
	/** Derived client-side from the already-loaded graph `links` (no fetch) — see `canvas-surface.tsx`'s `edge_chips_for`. */
	readonly blocked: boolean;
	readonly ready: boolean;
	/** True for one render pass right after an agent-created node first enters view — drives the `.canvas-node-cue` flash. */
	readonly showPlacementCue: boolean;
	/** Lazily fetched only for visible node/detail-LOD nodes (see `projections.ts`) — null until loaded, undefined if never requested. */
	readonly projection: NodeProjection | null | undefined;
	readonly onSelect: (id: string) => void;
	readonly onPointerDownNode: (id: string, event: PointerEvent) => void;
};

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

const STATUS_CHIP: Record<Task["progress"], { icon: typeof Check; label: string }> = {
	COMPLETED: { icon: Check, label: "done" },
	IN_PROGRESS: { icon: CircleDot, label: "in progress" },
	UNSTARTED: { icon: CircleDashed, label: "unstarted" },
};

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
	const show_detail_panel = () => props.level === "detail" && props.selected;
	const is_fold = () => FOLD_KINDS.has(props.task.kind);
	// The status chip always renders at node/detail LOD, so the chip row is
	// never actually empty — the old ".canvas-node-body always renders" bug
	// (~60% empty chrome per critic finding #3) predates that chip existing.
	const show_body = () => props.level === "node" || props.level === "detail";
	// Single source of truth (`layout.ts`'s `node_size_for`) for this node's
	// box — ONE fixed size regardless of LOD, also what dagre spacing/edge-
	// clipping read off, so the rendered card and the layout math can never
	// disagree. LOD only swaps inner content below; the `map`-tier dot/pill
	// look is a pure CSS `transform: scale` DOWN into this same box.
	const size = () => node_size_for(props.task.kind);

	return (
		<>
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
				style={{
					left: `${String(props.x)}px`,
					top: `${String(props.y)}px`,
					width: `${String(size().width)}px`,
					height: `${String(size().height)}px`,
					display: props.visible ? undefined : "none",
				}}
				tabIndex={0}
				aria-label={`${props.task.title}, ${String(progress_percent(props.task))}% complete`}
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
							style={{ "stroke-dashoffset": String(RING_CIRCUMFERENCE - dash()) }}
						/>
					</svg>
				</div>
				<Show when={show_body()}>
					<div class="canvas-node-body">
						<div class="canvas-node-chips" data-testid="canvas-node-chips">
							{(() => {
								const status = STATUS_CHIP[props.task.progress];
								const StatusIcon = status.icon;
								return (
									<span class="canvas-chip canvas-chip-status" data-testid="canvas-chip-status">
										<StatusIcon size={10} aria-hidden="true" />
										{status.label}
									</span>
								);
							})()}
							<Show when={props.blocked}>
								<span class="canvas-chip canvas-chip-blocked" data-testid="canvas-chip-blocked">
									<Lock size={10} aria-hidden="true" />
									blocked
								</span>
							</Show>
							<Show when={props.ready}>
								<span class="canvas-chip canvas-chip-ready" data-testid="canvas-chip-ready">
									<Zap size={10} aria-hidden="true" />
									ready
								</span>
							</Show>
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
					</div>
				</Show>
			</article>
			<Show when={show_detail_panel()}>
				<div
					class="canvas-node-detail-overlay"
					data-testid="canvas-node-detail-panel"
					style={{
						left: `${String(props.x - size().width / 2)}px`,
						top: `${String(props.y + size().height / 2 + 12)}px`,
						width: `${String(size().width)}px`,
						display: props.visible ? undefined : "none",
					}}
				>
					<Show when={props.projection?.pulseSpark && props.projection.pulseSpark.length > 0}>
						<Sparkline values={props.projection?.pulseSpark ?? []} />
					</Show>
					<Show when={props.task.description}>
						<p class="canvas-node-detail-desc">{props.task.description}</p>
					</Show>
				</div>
			</Show>
		</>
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
