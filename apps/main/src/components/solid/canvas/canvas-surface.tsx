import { getBrowserClient } from "@devpad/core/ui/client";
import {
	TASK_LINK_KINDS,
	type ProjectGraphResponse,
	type ProjectViewLayoutInput,
	type Task,
	type TaskLink,
} from "@devpad/schema";
import { curveMonotoneX, line } from "d3-shape";
import ChevronRight from "lucide-solid/icons/chevron-right";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CAMERA_LEVELS, create_camera, type CameraLevel, type ViewportSize } from "./camera";
import CanvasNode from "./canvas-node";
import {
	CANVAS_NODE_H,
	CANVAS_NODE_W,
	apply_view_overrides,
	clip_edge_endpoints,
	layout_graph,
	node_size_for,
	type EdgeKind,
} from "./layout";
import { fetch_node_projections, type NodeProjection } from "./projections";
import { build_spatial_index } from "./spatial-index";

export type CanvasSurfaceProps = {
	readonly projectId: string;
	readonly projectName: string;
	readonly initial: ProjectGraphResponse;
};

const LEVEL_LABEL: Record<CameraLevel, string> = {
	map: "Map",
	neighborhood: "Neighborhood",
	node: "Node",
	detail: "Detail",
};

/** Same edge-kind grammar as the graph lens (`lenses/graph-lens.tsx`) — shape
 * carries the meaning (dasharray), not just color, so it survives
 * color-blindness/print. Prefixed `canvas-` since this is a separate CSS
 * scope, not a shared stylesheet with the lens. `hierarchy` (parent_id
 * structure, never a `task_link` row) is thin/muted with no dasharray or
 * arrowhead — containment, not a directional relationship. */
const EDGE_CLASS: Record<EdgeKind, string> = {
	hierarchy: "canvas-edge-hierarchy",
	blocks: "canvas-edge-blocks",
	relates_to: "canvas-edge-relates",
	discovered_from: "canvas-edge-discovered",
	references: "canvas-edge-references",
	tracks_metric: "canvas-edge-metric",
};

const arrow_id_for = (kind: TaskLink["kind"]): string => `canvas-arrow-${kind.replace(/_/g, "-")}`;

const EDGE_LABEL: Record<EdgeKind, string> = {
	hierarchy: "hierarchy",
	blocks: "blocks",
	relates_to: "relates to",
	discovered_from: "discovered from",
	references: "references",
	tracks_metric: "tracks metric",
};

/** Legend order: structural hierarchy first, then the real `task_link` kinds. */
const EDGE_LEGEND_KINDS: readonly EdgeKind[] = ["hierarchy", ...TASK_LINK_KINDS];

type EdgeChips = { readonly blocked: boolean; readonly ready: boolean };
const NO_EDGE_CHIPS: EdgeChips = { blocked: false, ready: false };

/**
 * Client-side simplification of `packages/core/src/services/graph/edge-summary.ts`'s
 * `blocked_count`/`ready` — the canvas already holds the WHOLE project graph
 * (tasks + links), so this derives straight from that instead of adding a
 * fourth batched fetch alongside `projections.ts`. Deliberately drops the
 * `hook`/`stale` fields the outline's `EdgeSummary` also carries — those need
 * server-side hook-table/completed_via data this surface doesn't load.
 */
function edge_chips_for(tasks: readonly Task[], links: readonly TaskLink[]): Map<string, EdgeChips> {
	const incomplete_ids = new Set(tasks.filter((t) => t.progress !== "COMPLETED").map((t) => t.id));
	const blocked_by = new Map<string, number>();
	for (const link of links) {
		if (link.kind !== "blocks" || !link.dst_id || !incomplete_ids.has(link.src_id)) continue;
		blocked_by.set(link.dst_id, (blocked_by.get(link.dst_id) ?? 0) + 1);
	}
	const parents_with_open_children = new Set(
		tasks
			.filter((t): t is Task & { parent_id: string } => t.parent_id !== null && incomplete_ids.has(t.id))
			.map((t) => t.parent_id),
	);
	const now = new Date().toISOString();

	const result = new Map<string, EdgeChips>();
	for (const task of tasks) {
		const blocked_count = blocked_by.get(task.id) ?? 0;
		const has_incomplete_children = parents_with_open_children.has(task.id);
		const ready =
			task.progress !== "COMPLETED" &&
			(!task.start_time || task.start_time <= now) &&
			!has_incomplete_children &&
			blocked_count === 0;
		result.set(task.id, { blocked: blocked_count > 0, ready });
	}
	return result;
}

/** Smooths dagre's routed point lists into curved paths — `curveMonotoneX`
 * matches the `rankdir: "LR"` layout direction (monotonic left-to-right),
 * avoiding the hand-rolled bezier math a from-scratch curve would need. */
const line_gen = line<{ x: number; y: number }>()
	.x((p) => p.x)
	.y((p) => p.y)
	.curve(curveMonotoneX);
const path_for = (points: readonly { x: number; y: number }[]): string =>
	line_gen(points as { x: number; y: number }[]) ?? "";

const DOUBLE_CLICK_MS = 300;

/** A pointerdown-then-move under this many CSS px is still a click, not a drag — distinguishes "place this node" from "select this node". */
const DRAG_THRESHOLD_PX = 4;

/** Debounce window between the last drag-end and the view-state PUT — several quick re-pins in a row collapse into one write. */
const VIEW_STATE_SAVE_DEBOUNCE_MS = 500;

/** Placement-cue flash duration — mirrors the UX contract's `.placement_note` 3.6s auto-dismiss. */
const PLACEMENT_CUE_MS = 3600;

/**
 * Cell size ≈2x node footprint (per P2.4's spatial-index contract) so a
 * viewport rect only ever touches a handful of cells. The margin pads the
 * culling rect beyond the visible viewport so nodes don't pop in right at
 * the edge during a pan.
 */
const CULL_CELL_SIZE = Math.max(CANVAS_NODE_W, CANVAS_NODE_H) * 2;
const CULL_MARGIN = Math.max(CANVAS_NODE_W, CANVAS_NODE_H);

/** `.canvas-toolbar`'s `top: 16px` + `.canvas-breadcrumb`'s `min-height: 35px` + a little breathing room — kept a constant rather than measured, since the toolbar's own height doesn't respond to viewport resize. */
const CANVAS_TOOLBAR_INSET_PX = 64;

const EMPTY_LAYOUT_STATE: ProjectViewLayoutInput = { pins: {} };

/**
 * Full-viewport canvas home surface. Lives at its own route (`canvas.astro`)
 * with ZERO IA change: no nav links/tabs point here yet (P4). Click selects;
 * dblclick/Enter travel semantically into a node (P3.4); dragging a node
 * pins its position (P3.3); node/detail LOD lazily loads batched
 * projections (P3.2).
 */
export default function CanvasSurface(props: CanvasSurfaceProps) {
	const [data, setData] = createSignal<ProjectGraphResponse>(props.initial);
	const [selectedId, setSelectedId] = createSignal<string | null>(null);
	const [viewportSize, setViewportSize] = createSignal<ViewportSize>({ width: 0, height: 0 });
	const [pins, setPins] = createSignal<ProjectViewLayoutInput["pins"]>({});
	const [dragPreview, setDragPreview] = createSignal<{ id: string; x: number; y: number } | null>(null);
	const [ancestors, setAncestors] = createSignal<Task[]>([]);
	const [projections, setProjections] = createSignal<Map<string, NodeProjection>>(new Map());
	const [placementCueIds, setPlacementCueIds] = createSignal<ReadonlySet<string>>(new Set());
	let viewportRef: HTMLDivElement | undefined;

	const camera = create_camera({ fit_top_inset_px: CANVAS_TOOLBAR_INSET_PX });
	onCleanup(() => {
		camera.dispose();
	});
	const transform = camera.transform;

	const layout = createMemo(() => layout_graph(data().tasks, data().links));
	const edgeChips = createMemo(() => edge_chips_for(data().tasks, data().links));
	const placedLayout = createMemo(() => apply_view_overrides(layout(), undefined, pins()));
	const nodeById = createMemo(() => new Map(placedLayout().nodes.map((node) => [node.task.id, node])));

	createEffect(() => {
		const l = placedLayout();
		camera.set_content_bounds(l.nodes.length > 0 ? l.bounds : null);
	});

	// Keeps `zoom_to`/HUD level buttons framed on the selected node instead of
	// drifting to the content-bounds center once something is selected — see
	// camera.ts's `zoom_to` doc comment.
	createEffect(() => {
		const id = selectedId();
		const node = id === null ? undefined : placedLayout().nodes.find((n) => n.task.id === id);
		camera.set_focus(node ? { x: node.x, y: node.y } : null);
	});

	// Rebuilt only when the (possibly pin-overridden) layout changes — queried
	// below against the current viewport world rect for cheap per-frame culling.
	const spatialIndex = createMemo(() => {
		const l = placedLayout();
		return build_spatial_index(
			l.nodes.map((node) => ({
				id: node.task.id,
				x: node.x - CANVAS_NODE_W / 2,
				y: node.y - CANVAS_NODE_H / 2,
				w: CANVAS_NODE_W,
				h: CANVAS_NODE_H,
			})),
			CULL_CELL_SIZE,
		);
	});

	// null (not yet measured) means "render everything" — never cull before
	// we know the real viewport size.
	const visibleIds = createMemo((): ReadonlySet<string> | null => {
		const viewport = viewportSize();
		if (viewport.width <= 0 || viewport.height <= 0) return null;
		const t = transform();
		const rect = {
			x: -t.x / t.scale - CULL_MARGIN,
			y: -t.y / t.scale - CULL_MARGIN,
			w: viewport.width / t.scale + CULL_MARGIN * 2,
			h: viewport.height / t.scale + CULL_MARGIN * 2,
		};
		return spatialIndex().query(rect);
	});

	const is_visible = (id: string): boolean => {
		const visible = visibleIds();
		return visible === null || visible.has(id);
	};

	// LOD swap only lands once the camera settles — swapping mid-animation
	// (e.g. map -> node body content appearing halfway through a zoom_to
	// tween) is exactly the thrash the UX contract calls out to avoid.
	const [stableLevel, setStableLevel] = createSignal<CameraLevel>(camera.level());
	createEffect(() => {
		const moving = camera.is_moving();
		const level = camera.level();
		if (!moving) setStableLevel(level);
	});

	// P3.2 — lazy, batched, ONE-TIME (per project graph revalidate) load once
	// the camera first reaches node/detail LOD; map/neighborhood never fetch
	// anything extra, and there's no per-node fan-out once loaded.
	let projections_loaded = false;
	createEffect(() => {
		const level = stableLevel();
		if (level !== "node" && level !== "detail") return;
		if (projections_loaded) return;
		projections_loaded = true;
		void fetch_node_projections(getBrowserClient(), props.projectId, data().tasks, data().links).then(setProjections);
	});

	// P3.3 — one-time placement cue for agent-created nodes the instant the
	// camera leaves `map` (mirrors the UX contract's single `placement_note`
	// flash rather than re-showing on every subsequent zoom).
	let cue_shown = false;
	createEffect(() => {
		if (cue_shown || stableLevel() === "map") return;
		const ids = placedLayout().programmaticIds;
		if (ids.size === 0) return;
		cue_shown = true;
		setPlacementCueIds(ids);
		setTimeout(() => setPlacementCueIds(new Set()), PLACEMENT_CUE_MS);
	});

	const revalidate = async () => {
		const result = await getBrowserClient().projects.graph(props.projectId);
		if (result.ok) {
			setData(result.value);
			projections_loaded = false;
		}
	};

	// Fire-and-forget, last-write-wins — a failed save leaves the pin live in
	// memory (never silently reverted, which would surprise a user mid-drag)
	// but surfaces via `saveFailed` so `.canvas-layout-status` can say
	// "unsaved" instead of implying the pin persisted.
	const [saveFailed, setSaveFailed] = createSignal(false);
	const save_view_state = (next_layout: ProjectViewLayoutInput) => {
		void getBrowserClient()
			.projects.putViewState(props.projectId, next_layout)
			.then((result) => {
				setSaveFailed(!result.ok);
			});
	};

	let save_timer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		clearTimeout(save_timer);
	});
	const schedule_save = (next_pins: ProjectViewLayoutInput["pins"]) => {
		clearTimeout(save_timer);
		save_timer = setTimeout(() => {
			save_view_state({ pins: next_pins });
		}, VIEW_STATE_SAVE_DEBOUNCE_MS);
	};

	const reset_layout = () => {
		clearTimeout(save_timer);
		setPins({});
		save_view_state(EMPTY_LAYOUT_STATE);
	};

	onMount(() => {
		const viewport = viewportRef;
		if (!viewport) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const size = { width: entry.contentRect.width, height: entry.contentRect.height };
			camera.set_viewport(size);
			setViewportSize(size);
		});
		observer.observe(viewport);
		onCleanup(() => {
			observer.disconnect();
		});

		// Non-passive — the camera's stepped zoom needs to preventDefault the
		// page scroll on every wheel tick, which a passive listener can't do.
		const on_wheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = viewport.getBoundingClientRect();
			camera.on_wheel({
				offsetX: e.clientX - rect.left,
				offsetY: e.clientY - rect.top,
				deltaY: e.deltaY,
				ctrlKey: e.ctrlKey,
			});
		};
		viewport.addEventListener("wheel", on_wheel, { passive: false });
		onCleanup(() => {
			viewport.removeEventListener("wheel", on_wheel);
		});

		camera.fit();
		void revalidate();
		void getBrowserClient()
			.projects.getViewState(props.projectId)
			.then((result) => {
				if (result.ok) setPins(result.value.pins);
			});
	});

	let dragging = false;
	const on_pointer_down = (e: PointerEvent) => {
		// A pointerdown that landed on a node card is a click/dblclick/drag
		// candidate, not a pan gesture — same rule as the graph lens. The HUD
		// toolbar needs the same bail: `setPointerCapture` below re-targets the
		// FOLLOWING pointerup at the viewport, and Chromium suppresses the
		// synthesized `click` when its up-target differs from its down-target
		// — so capturing on a toolbar-button pointerdown silently eats every
		// HUD click.
		// P3.3's reset button lives in `.canvas-layout-status` — a separate
		// overlay from `.canvas-toolbar` (see camera.ts's documented pointer-
		// capture gotcha: ANY toolbar/HUD control needs this same exclusion, or
		// `setPointerCapture` below re-targets its pointerup and Chromium
		// silently swallows the synthesized click).
		const target = e.target;
		if (target instanceof Element && target.closest("[data-canvas-node], .canvas-toolbar, .canvas-layout-status"))
			return;
		dragging = true;
		camera.on_pointer_down(e);
		const current_target = e.currentTarget;
		if (current_target instanceof Element) current_target.setPointerCapture(e.pointerId);
	};
	const on_pointer_move = (e: PointerEvent) => {
		if (!dragging) return;
		camera.on_pointer_move(e);
	};
	const on_pointer_up = () => {
		dragging = false;
		camera.on_pointer_up();
	};

	// P3.3 — node placement drag. Never shares the viewport's pointer capture
	// (the guard above already excludes `[data-canvas-node]`), so this can
	// freely track its own window-level listeners without fighting pan.
	let node_drag: {
		id: string;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null = null;
	let suppress_click_for: string | null = null;

	const on_node_drag_move = (e: PointerEvent) => {
		if (!node_drag) return;
		const dx_screen = e.clientX - node_drag.startX;
		const dy_screen = e.clientY - node_drag.startY;
		if (!node_drag.moved && Math.hypot(dx_screen, dy_screen) < DRAG_THRESHOLD_PX) return;
		node_drag.moved = true;
		const scale = transform().scale;
		setDragPreview({
			id: node_drag.id,
			x: node_drag.originX + dx_screen / scale,
			y: node_drag.originY + dy_screen / scale,
		});
	};
	const on_node_drag_up = () => {
		window.removeEventListener("pointermove", on_node_drag_move);
		if (node_drag?.moved) {
			const preview = dragPreview();
			if (preview) {
				const next_pins = { ...pins(), [preview.id]: { x: preview.x, y: preview.y } };
				setPins(next_pins);
				schedule_save(next_pins);
			}
			suppress_click_for = node_drag.id;
		}
		setDragPreview(null);
		node_drag = null;
	};
	// `typeof window` guard — this cleanup runs unconditionally at dispose
	// (including during Astro's server-side render pass, where `window`
	// doesn't exist), regardless of whether a drag ever actually attached
	// the listener.
	onCleanup(() => {
		if (typeof window !== "undefined") window.removeEventListener("pointermove", on_node_drag_move);
	});

	const on_node_pointer_down = (id: string, e: PointerEvent) => {
		const node = placedLayout().nodes.find((n) => n.task.id === id);
		if (!node) return;
		node_drag = { id, startX: e.clientX, startY: e.clientY, originX: node.x, originY: node.y, moved: false };
		window.addEventListener("pointermove", on_node_drag_move);
		window.addEventListener("pointerup", on_node_drag_up, { once: true });
	};

	/** Semantic travel (P3.4) — reuses the same `tasks.ancestors()` primitive the outline uses for its breadcrumb; the canvas already holds the whole project graph (unlike the outline's windowed `tree()` reads) so travel only needs to move the camera + swap the ancestor chain, not re-fetch node data. */
	const travel_to = async (id: string) => {
		setSelectedId(id);
		camera.zoom_to("detail");
		const result = await getBrowserClient().tasks.ancestors(id);
		if (result.ok) setAncestors(result.value);
	};

	const travel_up = () => {
		const parent = ancestors().at(0) ?? null;
		if (parent) {
			void travel_to(parent.id);
			return;
		}
		setSelectedId(null);
		setAncestors([]);
		camera.zoom_to("neighborhood");
	};

	let pending_id: string | null = null;
	let pending_timer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		clearTimeout(pending_timer);
	});

	const on_node_select = (id: string) => {
		if (suppress_click_for === id) {
			suppress_click_for = null;
			return;
		}
		if (pending_id === id && pending_timer) {
			clearTimeout(pending_timer);
			pending_timer = undefined;
			pending_id = null;
			void travel_to(id);
			return;
		}
		pending_id = id;
		pending_timer = setTimeout(() => {
			setSelectedId(id);
			pending_timer = undefined;
			pending_id = null;
		}, DOUBLE_CLICK_MS);
	};

	const node_position = (node: { task: Task; x: number; y: number }) => {
		const preview = dragPreview();
		return preview && preview.id === node.task.id ? { x: preview.x, y: preview.y } : { x: node.x, y: node.y };
	};

	const selected_edge_ids = createMemo((): ReadonlySet<string> => {
		const id = selectedId();
		if (id === null) return new Set();
		return new Set(
			placedLayout()
				.edges.filter((edge) => edge.src_id === id || edge.dst_id === id)
				.map((edge) => edge.id),
		);
	});

	/** Clips each edge's endpoints to the ACTUAL box its src/dst renders at the
	 * current LOD (`node_size_for` — the same source `CanvasNode` reads), so
	 * arrowheads land on the visible border instead of dagre's uniform
	 * `CANVAS_NODE_W`/`CANVAS_NODE_H` spacing box, which the real per-LOD card
	 * is almost always smaller (or, at `detail`, larger) than. */
	const renderableEdges = createMemo(() => {
		const level = stableLevel();
		const by_id = nodeById();
		return placedLayout()
			.edges.filter((edge) => is_visible(edge.src_id) || is_visible(edge.dst_id))
			.flatMap((edge) => {
				const src = by_id.get(edge.src_id);
				const dst = by_id.get(edge.dst_id);
				if (!src || !dst) return [];
				const src_pos = node_position(src);
				const dst_pos = node_position(dst);
				const points = clip_edge_endpoints(
					edge.points,
					{ x: src_pos.x, y: src_pos.y, size: node_size_for(src.task.kind, level) },
					{ x: dst_pos.x, y: dst_pos.y, size: node_size_for(dst.task.kind, level) },
				);
				return [{ ...edge, points }];
			});
	});

	const pinnedCount = () => Object.keys(pins()).length;
	const breadcrumb = () => [...ancestors()].toReversed();
	const currentTitle = () => {
		const id = selectedId();
		if (id === null) return null;
		return data().tasks.find((t) => t.id === id)?.title ?? null;
	};

	return (
		<div
			ref={viewportRef}
			class="canvas-viewport"
			classList={{ "canvas-viewport-moving": camera.is_moving() }}
			data-testid="canvas-viewport"
			aria-label="Interactive project canvas"
			tabIndex={0}
			onPointerDown={on_pointer_down}
			onPointerMove={on_pointer_move}
			onPointerUp={on_pointer_up}
			onPointerLeave={on_pointer_up}
			onKeyDown={(e) => {
				if ((e.key === "Escape" || e.key === "Backspace") && (selectedId() !== null || ancestors().length > 0)) {
					e.preventDefault();
					travel_up();
					return;
				}
				if (e.key === "Enter" && selectedId() !== null) {
					const id = selectedId();
					if (id) void travel_to(id);
					return;
				}
				camera.handle_key(e);
			}}
		>
			<div class="canvas-toolbar">
				<div class="canvas-breadcrumb" data-testid="canvas-breadcrumb">
					<button
						type="button"
						class="canvas-crumb-btn"
						onClick={() => {
							travel_up();
						}}
					>
						{props.projectName}
					</button>
					<For each={breadcrumb()}>
						{(ancestor) => (
							<>
								<ChevronRight class="canvas-icon" size={12} aria-hidden="true" />
								<button type="button" class="canvas-crumb-btn" onClick={() => void travel_to(ancestor.id)}>
									{ancestor.title}
								</button>
							</>
						)}
					</For>
					<ChevronRight class="canvas-icon" size={12} aria-hidden="true" />
					<span class="canvas-crumb-current" data-testid="canvas-crumb-current">
						{currentTitle() ?? "canvas home"}
					</span>
				</div>
				<div class="canvas-zoom-hud" role="group" aria-label="Semantic zoom level">
					<For each={CAMERA_LEVELS}>
						{(level) => (
							<button
								type="button"
								class="canvas-level-btn"
								classList={{ "canvas-level-btn-active": stableLevel() === level }}
								onClick={() => {
									camera.zoom_to(level);
								}}
							>
								{LEVEL_LABEL[level]}
							</button>
						)}
					</For>
				</div>
			</div>

			<div
				class="canvas-world"
				classList={{ "canvas-world-moving": camera.is_moving() }}
				style={{
					transform: `translate(${String(transform().x)}px, ${String(transform().y)}px) scale(${String(transform().scale)})`,
				}}
			>
				<svg class="canvas-edges" aria-hidden="true">
					<defs>
						<For each={TASK_LINK_KINDS}>
							{(kind) => (
								<marker
									id={arrow_id_for(kind)}
									viewBox="0 0 10 10"
									refX="9"
									refY="5"
									markerWidth="7"
									markerHeight="7"
									orient="auto-start-reverse"
								>
									<path d="M0,0 L10,5 L0,10 z" class={`canvas-arrowhead ${EDGE_CLASS[kind]}-arrowhead`} />
								</marker>
							)}
						</For>
					</defs>
					<For each={renderableEdges()}>
						{(edge) => (
							<path
								d={path_for(edge.points)}
								class={`canvas-edge ${EDGE_CLASS[edge.kind]}`}
								classList={{ "canvas-edge-selected": selected_edge_ids().has(edge.id) }}
								data-edge-kind={edge.kind}
								marker-end={edge.kind === "hierarchy" ? undefined : `url(#${arrow_id_for(edge.kind)})`}
							/>
						)}
					</For>
				</svg>
				<For each={placedLayout().nodes}>
					{(node) => (
						<CanvasNode
							task={node.task}
							x={node_position(node).x}
							y={node_position(node).y}
							level={stableLevel()}
							selected={selectedId() === node.task.id}
							visible={is_visible(node.task.id)}
							pinned={Object.hasOwn(pins(), node.task.id)}
							programmatic={placedLayout().programmaticIds.has(node.task.id)}
							blocked={(edgeChips().get(node.task.id) ?? NO_EDGE_CHIPS).blocked}
							ready={(edgeChips().get(node.task.id) ?? NO_EDGE_CHIPS).ready}
							showPlacementCue={placementCueIds().has(node.task.id)}
							projection={
								stableLevel() === "node" || stableLevel() === "detail"
									? (projections().get(node.task.id) ?? null)
									: undefined
							}
							onSelect={on_node_select}
							onPointerDownNode={on_node_pointer_down}
						/>
					)}
				</For>
			</div>

			<p class="canvas-layout-status" data-testid="canvas-layout-status">
				layout <strong>{pinnedCount() > 0 ? `${String(pinnedCount())} pinned` : "auto"}</strong>
				<Show when={saveFailed()}>
					<span class="canvas-layout-unsaved" data-testid="canvas-layout-unsaved">
						unsaved
					</span>
				</Show>
				<Show when={pinnedCount() > 0}>
					<button type="button" class="canvas-reset-btn" data-testid="canvas-reset-layout" onClick={reset_layout}>
						<RotateCcw class="canvas-icon" size={12} aria-hidden="true" />
						reset
					</button>
				</Show>
			</p>

			<div class="canvas-legend" data-testid="canvas-legend">
				<For each={EDGE_LEGEND_KINDS}>
					{(kind) => (
						<span class="canvas-legend-item">
							<svg class="canvas-legend-swatch" viewBox="0 0 10 10" aria-hidden="true">
								<Show
									when={kind !== "hierarchy"}
									fallback={<line x1="0" y1="5" x2="10" y2="5" class="canvas-edge-hierarchy" stroke-width="1.5" />}
								>
									<path d="M0,0 L10,5 L0,10 z" class={`canvas-arrowhead ${EDGE_CLASS[kind]}-arrowhead`} />
								</Show>
							</svg>
							{EDGE_LABEL[kind]}
						</span>
					)}
				</For>
			</div>

			<div class="canvas-hintbar" aria-label="Keyboard shortcuts">
				<span>
					<kbd>+</kbd>/<kbd>-</kbd> zoom level
				</span>
				<span>
					<kbd>0</kbd> fit
				</span>
				<span>
					<kbd>↑↓←→</kbd> pan
				</span>
				<span>
					<kbd>click</kbd> select
				</span>
				<span>
					<kbd>Enter</kbd> travel
				</span>
				<span>
					<kbd>Esc</kbd> travel up
				</span>
			</div>
		</div>
	);
}
