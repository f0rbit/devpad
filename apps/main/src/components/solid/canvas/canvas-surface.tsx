import { getBrowserClient } from "@devpad/core/ui/client";
import { TASK_LINK_KINDS, type ProjectGraphResponse, type TaskLink } from "@devpad/schema";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { CAMERA_LEVELS, create_camera, type CameraLevel, type ViewportSize } from "./camera";
import CanvasNode from "./canvas-node";
import { CANVAS_NODE_H, CANVAS_NODE_W, layout_graph } from "./layout";
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
 * scope, not a shared stylesheet with the lens. */
const EDGE_CLASS: Record<TaskLink["kind"], string> = {
	blocks: "canvas-edge-blocks",
	relates_to: "canvas-edge-relates",
	discovered_from: "canvas-edge-discovered",
	references: "canvas-edge-references",
	tracks_metric: "canvas-edge-metric",
};

const arrow_id_for = (kind: TaskLink["kind"]): string => `canvas-arrow-${kind.replace(/_/g, "-")}`;

const path_for = (points: readonly { x: number; y: number }[]): string => points.map((p, i) => `${i === 0 ? "M" : "L"}${String(p.x)},${String(p.y)}`).join(" ");

const DOUBLE_CLICK_MS = 300;

/**
 * Cell size ≈2x node footprint (per P2.4's spatial-index contract) so a
 * viewport rect only ever touches a handful of cells. The margin pads the
 * culling rect beyond the visible viewport so nodes don't pop in right at
 * the edge during a pan.
 */
const CULL_CELL_SIZE = Math.max(CANVAS_NODE_W, CANVAS_NODE_H) * 2;
const CULL_MARGIN = Math.max(CANVAS_NODE_W, CANVAS_NODE_H);

/**
 * Full-viewport canvas home surface (P2.3) — dagre layered layout piped
 * through the stepped-zoom camera module. Lives at its own route
 * (`canvas.astro`) with ZERO IA change: no nav links/tabs point here yet
 * (P4). Click selects; dblclick is reserved for P3's semantic travel but
 * keeps the same 300ms disambiguation timer as the graph lens so wiring it
 * up later doesn't reshuffle the gesture handling.
 */
export default function CanvasSurface(props: CanvasSurfaceProps) {
	const [data, setData] = createSignal<ProjectGraphResponse>(props.initial);
	const [selectedId, setSelectedId] = createSignal<string | null>(null);
	const [viewportSize, setViewportSize] = createSignal<ViewportSize>({ width: 0, height: 0 });
	let viewportRef: HTMLDivElement | undefined;

	const camera = create_camera();
	onCleanup(() => camera.dispose());
	const transform = camera.transform;

	const layout = createMemo(() => layout_graph(data().tasks, data().links));

	createEffect(() => {
		const l = layout();
		camera.set_content_bounds(l.nodes.length > 0 ? l.bounds : null);
	});

	// Rebuilt only when the layout changes (not per frame) — queried below
	// against the current viewport world rect for cheap per-frame culling.
	const spatialIndex = createMemo(() => {
		const l = layout();
		return build_spatial_index(
			l.nodes.map(node => ({ id: node.task.id, x: node.x - CANVAS_NODE_W / 2, y: node.y - CANVAS_NODE_H / 2, w: CANVAS_NODE_W, h: CANVAS_NODE_H })),
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

	const revalidate = async () => {
		const result = await getBrowserClient().projects.graph(props.projectId);
		if (result.ok) setData(result.value);
	};

	onMount(() => {
		const viewport = viewportRef;
		if (!viewport) return;

		const observer = new ResizeObserver(entries => {
			const entry = entries[0];
			if (!entry) return;
			const size = { width: entry.contentRect.width, height: entry.contentRect.height };
			camera.set_viewport(size);
			setViewportSize(size);
		});
		observer.observe(viewport);
		onCleanup(() => observer.disconnect());

		// Non-passive — the camera's stepped zoom needs to preventDefault the
		// page scroll on every wheel tick, which a passive listener can't do.
		const on_wheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = viewport.getBoundingClientRect();
			camera.on_wheel({ offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, deltaY: e.deltaY, ctrlKey: e.ctrlKey });
		};
		viewport.addEventListener("wheel", on_wheel, { passive: false });
		onCleanup(() => viewport.removeEventListener("wheel", on_wheel));

		camera.fit();
		void revalidate();
	});

	let dragging = false;
	const on_pointer_down = (e: PointerEvent) => {
		// A pointerdown that landed on a node card is a click/dblclick
		// candidate, not a pan gesture — same rule as the graph lens.
		if ((e.target as Element).closest("[data-canvas-node]")) return;
		dragging = true;
		camera.on_pointer_down(e);
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	};
	const on_pointer_move = (e: PointerEvent) => {
		if (!dragging) return;
		camera.on_pointer_move(e);
	};
	const on_pointer_up = () => {
		dragging = false;
		camera.on_pointer_up();
	};

	let pending_id: string | null = null;
	let pending_timer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(pending_timer));

	const on_node_select = (id: string) => {
		if (pending_id === id && pending_timer) {
			clearTimeout(pending_timer);
			pending_timer = undefined;
			pending_id = null;
			// P3 wires semantic travel into the dblclick slot here.
			return;
		}
		pending_id = id;
		pending_timer = setTimeout(() => {
			setSelectedId(id);
			pending_timer = undefined;
			pending_id = null;
		}, DOUBLE_CLICK_MS);
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
			onKeyDown={e => camera.handle_key(e)}
		>
			<div class="canvas-toolbar">
				<div class="canvas-breadcrumb" data-testid="canvas-breadcrumb">
					<span>{props.projectName}</span>
					<ChevronRight class="canvas-icon" size={12} aria-hidden="true" />
					<span class="canvas-crumb-current">canvas home</span>
				</div>
				<div class="canvas-zoom-hud" role="group" aria-label="Semantic zoom level">
					<For each={CAMERA_LEVELS}>
						{level => (
							<button type="button" class="canvas-level-btn" classList={{ "canvas-level-btn-active": camera.level() === level }} onClick={() => camera.zoom_to(level)}>
								{LEVEL_LABEL[level]}
							</button>
						)}
					</For>
				</div>
			</div>

			<div class="canvas-world" classList={{ "canvas-world-moving": camera.is_moving() }} style={{ transform: `translate(${transform().x}px, ${transform().y}px) scale(${transform().scale})` }}>
				<svg class="canvas-edges" aria-hidden="true">
					<defs>
						<For each={TASK_LINK_KINDS}>{kind => <marker id={arrow_id_for(kind)} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class={`canvas-arrowhead ${EDGE_CLASS[kind]}-arrowhead`} /></marker>}</For>
					</defs>
					<For each={layout().edges.filter(edge => is_visible(edge.src_id) || is_visible(edge.dst_id))}>
						{edge => <path d={path_for(edge.points)} class={`canvas-edge ${EDGE_CLASS[edge.kind]}`} marker-end={`url(#${arrow_id_for(edge.kind)})`} />}
					</For>
				</svg>
				<For each={layout().nodes}>
					{node => (
						<CanvasNode
							task={node.task}
							x={node.x}
							y={node.y}
							level={stableLevel()}
							selected={selectedId() === node.task.id}
							visible={is_visible(node.task.id)}
							onSelect={on_node_select}
						/>
					)}
				</For>
			</div>

			<p class="canvas-layout-status" data-testid="canvas-layout-status">
				layout <strong>dagre · LR</strong>
			</p>

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
			</div>
		</div>
	);
}
