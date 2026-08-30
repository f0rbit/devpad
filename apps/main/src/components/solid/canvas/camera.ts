import { createRoot, createSignal, untrack, type Accessor } from "solid-js";

/**
 * Camera primitive for the canvas home surface. Extracted from
 * `lenses/graph-lens.tsx`'s transform/wheel/pan math (kept identical) and
 * extended per the canvas UX contract (`.plans/canvas-mock.html`): stepped
 * semantic zoom levels, a content-bounds clamp so pan/zoom never shows only
 * void, and an `is_moving` signal LOD swaps can debounce against.
 *
 * Deliberately DOM-free: callers pass plain structural event shapes
 * (`WheelInput`/`PointerInput`/`KeyInput`) instead of real `WheelEvent` /
 * `PointerEvent` — native events satisfy these shapes, but it keeps this
 * module testable without a DOM and without wiring `getBoundingClientRect`.
 */

export const CAMERA_LEVELS = ["map", "neighborhood", "node", "detail"] as const;
export type CameraLevel = (typeof CAMERA_LEVELS)[number];

export type Transform = { readonly x: number; readonly y: number; readonly scale: number };
export type ContentBounds = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type ViewportSize = { readonly width: number; readonly height: number };
export type Point = { readonly x: number; readonly y: number };

export type WheelInput = {
	readonly offsetX: number;
	readonly offsetY: number;
	readonly deltaY: number;
	readonly ctrlKey: boolean;
	readonly preventDefault?: () => void;
};
export type PointerInput = { readonly clientX: number; readonly clientY: number };
export type KeyInput = { readonly key: string; readonly preventDefault?: () => void };

export type CameraOptions = {
	readonly initial_level?: CameraLevel;
	readonly initial_transform?: Transform;
	/** ms for a level-to-level animated snap. 0 makes zoom_to/fit synchronous — used by tests. */
	readonly animation_ms?: number;
	/** ms of wheel silence before a free-scroll scale snaps to its nearest level. 0 settles synchronously — used by tests. */
	readonly wheel_settle_ms?: number;
	readonly wheel_sensitivity?: number;
	readonly pan_step?: number;
	readonly clamp_margin?: number;
	readonly fit_margin?: number;
};

export type Camera = {
	readonly transform: Accessor<Transform>;
	readonly level: Accessor<CameraLevel>;
	readonly is_moving: Accessor<boolean>;
	readonly on_wheel: (e: WheelInput) => void;
	readonly on_pointer_down: (e: PointerInput) => void;
	readonly on_pointer_move: (e: PointerInput) => void;
	readonly on_pointer_up: () => void;
	readonly zoom_to: (level: CameraLevel, anchor?: Point) => void;
	readonly zoom_in: (anchor?: Point) => void;
	readonly zoom_out: (anchor?: Point) => void;
	readonly fit: () => void;
	readonly set_content_bounds: (bounds: ContentBounds | null) => void;
	readonly set_viewport: (viewport: ViewportSize) => void;
	readonly handle_key: (e: KeyInput) => void;
	readonly dispose: () => void;
};

export const LEVEL_SCALE: Record<CameraLevel, number> = { map: 0.58, neighborhood: 0.82, node: 1, detail: 1.08 };

const DEFAULT_ANIMATION_MS = 200;
const DEFAULT_WHEEL_SETTLE_MS = 140;
const DEFAULT_WHEEL_SENSITIVITY = 0.0012;
const DEFAULT_PAN_STEP = 48;
const DEFAULT_CLAMP_MARGIN = 48;
const DEFAULT_FIT_MARGIN = 40;

const MIN_SCALE = LEVEL_SCALE.map;
const MAX_SCALE = LEVEL_SCALE.detail;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const ease_out_cubic = (t: number): number => 1 - Math.pow(1 - t, 3);

const nearest_level = (scale: number): CameraLevel =>
	CAMERA_LEVELS.reduce((best, level) =>
		Math.abs(LEVEL_SCALE[level] - scale) < Math.abs(LEVEL_SCALE[best] - scale) ? level : best,
	);

const levels_by_scale_desc = CAMERA_LEVELS.toSorted((a, b) => LEVEL_SCALE[b] - LEVEL_SCALE[a]);

const best_fit_level = (bounds: ContentBounds, viewport: ViewportSize, margin: number): CameraLevel => {
	const usable_w = Math.max(0, viewport.width - margin * 2);
	const usable_h = Math.max(0, viewport.height - margin * 2);
	const fits = (level: CameraLevel) =>
		bounds.w * LEVEL_SCALE[level] <= usable_w && bounds.h * LEVEL_SCALE[level] <= usable_h;
	return levels_by_scale_desc.find(fits) ?? "map";
};

const clamp_transform = (
	t: Transform,
	bounds: ContentBounds | null,
	viewport: ViewportSize,
	margin: number,
): Transform => {
	if (!bounds || bounds.w <= 0 || bounds.h <= 0 || viewport.width <= 0 || viewport.height <= 0) return t;
	const min_x = margin - (bounds.x + bounds.w) * t.scale;
	const max_x = viewport.width - margin - bounds.x * t.scale;
	const min_y = margin - (bounds.y + bounds.h) * t.scale;
	const max_y = viewport.height - margin - bounds.y * t.scale;
	const x = min_x <= max_x ? clamp(t.x, min_x, max_x) : (min_x + max_x) / 2;
	const y = min_y <= max_y ? clamp(t.y, min_y, max_y) : (min_y + max_y) / 2;
	return { x, y, scale: t.scale };
};

const raf: (cb: (t: number) => void) => number =
	typeof requestAnimationFrame === "function"
		? requestAnimationFrame
		: (cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number;

const cancel_raf: (handle: number) => void =
	typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : (handle) => clearTimeout(handle);

export function create_camera(opts: CameraOptions = {}): Camera {
	const animation_ms = opts.animation_ms ?? DEFAULT_ANIMATION_MS;
	const wheel_settle_ms = opts.wheel_settle_ms ?? DEFAULT_WHEEL_SETTLE_MS;
	const wheel_sensitivity = opts.wheel_sensitivity ?? DEFAULT_WHEEL_SENSITIVITY;
	const pan_step = opts.pan_step ?? DEFAULT_PAN_STEP;
	const clamp_margin = opts.clamp_margin ?? DEFAULT_CLAMP_MARGIN;
	const fit_margin = opts.fit_margin ?? DEFAULT_FIT_MARGIN;

	const initial_level = opts.initial_level ?? "map";
	const initial_transform = opts.initial_transform ?? { x: 0, y: 0, scale: LEVEL_SCALE[initial_level] };

	return createRoot((dispose_root) => {
		const [transform, set_transform] = createSignal<Transform>(initial_transform);
		const [level, set_level] = createSignal<CameraLevel>(initial_level);
		const [is_moving, set_is_moving] = createSignal(false);

		let bounds: ContentBounds | null = null;
		let viewport: ViewportSize = { width: 0, height: 0 };
		let dragging = false;
		let last_point: Point = { x: 0, y: 0 };
		let animation_frame: number | null = null;
		let wheel_settle_timer: ReturnType<typeof setTimeout> | undefined;
		let last_wheel_anchor: Point = { x: 0, y: 0 };

		const cancel_animation = () => {
			if (animation_frame !== null) {
				cancel_raf(animation_frame);
				animation_frame = null;
			}
		};
		const cancel_wheel_settle = () => {
			clearTimeout(wheel_settle_timer);
			wheel_settle_timer = undefined;
		};

		const apply_clamped = (t: Transform) => set_transform(clamp_transform(t, bounds, viewport, clamp_margin));

		const animate_to = (target: Transform, next_level: CameraLevel) => {
			cancel_animation();
			set_level(next_level);
			const from = transform();
			if (animation_ms <= 0) {
				apply_clamped(target);
				if (!dragging) set_is_moving(false);
				return;
			}
			set_is_moving(true);
			const start = Date.now();
			const step = () => {
				const elapsed = Date.now() - start;
				const raw = Math.min(1, elapsed / animation_ms);
				const eased = ease_out_cubic(raw);
				apply_clamped({
					x: lerp(from.x, target.x, eased),
					y: lerp(from.y, target.y, eased),
					scale: lerp(from.scale, target.scale, eased),
				});
				if (raw < 1) {
					animation_frame = raf(step);
					return;
				}
				animation_frame = null;
				if (!dragging) set_is_moving(false);
			};
			animation_frame = raf(step);
		};

		const zoom_to = (target_level: CameraLevel, anchor?: Point) => {
			const t = transform();
			const point = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
			const target_scale = LEVEL_SCALE[target_level];
			const world_x = (point.x - t.x) / t.scale;
			const world_y = (point.y - t.y) / t.scale;
			animate_to(
				{ x: point.x - world_x * target_scale, y: point.y - world_y * target_scale, scale: target_scale },
				target_level,
			);
		};

		const step_level = (direction: 1 | -1, anchor?: Point) => {
			const index = CAMERA_LEVELS.indexOf(level());
			const next_index = clamp(index + direction, 0, CAMERA_LEVELS.length - 1);
			const next = CAMERA_LEVELS[next_index];
			if (next !== undefined) zoom_to(next, anchor);
		};

		const fit = () => {
			if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
				animate_to({ x: 0, y: 0, scale: LEVEL_SCALE.map }, "map");
				return;
			}
			const target_level = best_fit_level(bounds, viewport, fit_margin);
			const scale = LEVEL_SCALE[target_level];
			const target = {
				x: viewport.width / 2 - (bounds.x + bounds.w / 2) * scale,
				y: viewport.height / 2 - (bounds.y + bounds.h / 2) * scale,
				scale,
			};
			animate_to(target, target_level);
		};

		const settle_wheel = () => {
			wheel_settle_timer = undefined;
			const nearest = nearest_level(transform().scale);
			zoom_to(nearest, last_wheel_anchor);
		};

		const on_wheel = (e: WheelInput) => {
			e.preventDefault?.();
			cancel_animation();
			const t = transform();
			const anchor = { x: e.offsetX, y: e.offsetY };
			last_wheel_anchor = anchor;
			const delta = -e.deltaY * wheel_sensitivity;
			const next_scale = clamp(t.scale + delta, MIN_SCALE, MAX_SCALE);
			const world_x = (anchor.x - t.x) / t.scale;
			const world_y = (anchor.y - t.y) / t.scale;
			apply_clamped({ x: anchor.x - world_x * next_scale, y: anchor.y - world_y * next_scale, scale: next_scale });
			set_is_moving(true);
			cancel_wheel_settle();
			if (wheel_settle_ms <= 0) {
				settle_wheel();
				return;
			}
			wheel_settle_timer = setTimeout(settle_wheel, wheel_settle_ms);
		};

		const on_pointer_down = (e: PointerInput) => {
			cancel_animation();
			cancel_wheel_settle();
			dragging = true;
			last_point = { x: e.clientX, y: e.clientY };
			set_is_moving(true);
		};
		const on_pointer_move = (e: PointerInput) => {
			if (!dragging) return;
			const dx = e.clientX - last_point.x;
			const dy = e.clientY - last_point.y;
			last_point = { x: e.clientX, y: e.clientY };
			const t = transform();
			apply_clamped({ x: t.x + dx, y: t.y + dy, scale: t.scale });
		};
		const on_pointer_up = () => {
			dragging = false;
			set_is_moving(false);
		};

		// `untrack` here is load-bearing, not defensive polish: both setters are
		// called from OUTSIDE this module (a caller's `createEffect` for
		// `set_content_bounds`, a `ResizeObserver` callback for `set_viewport`),
		// and Solid's dependency tracking is call-stack based — an untracked
		// read of `transform()` reads the CURRENT value to reclamp without
		// accidentally subscribing the caller's effect to it. Without this, a
		// caller effect that calls `set_content_bounds` synchronously picks up
		// `transform` as an accidental dependency; since `apply_clamped` always
		// writes a NEW object (even when numerically unchanged), every write
		// re-triggers that same effect, which reclamps and writes again —
		// a self-sustaining reactive loop that eventually stack-overflows.
		const set_content_bounds = (next_bounds: ContentBounds | null) => {
			bounds = next_bounds;
			apply_clamped(untrack(transform));
		};
		const set_viewport = (next_viewport: ViewportSize) => {
			viewport = next_viewport;
			apply_clamped(untrack(transform));
		};

		// Arrows pan, +/- step the semantic zoom level, 0 fits — same vocabulary
		// slot as the outline's onKeyDown (1/2/3 depth, z zoom, f/0 fit).
		const handle_key = (e: KeyInput) => {
			const t = transform();
			switch (e.key) {
				case "ArrowUp":
					e.preventDefault?.();
					apply_clamped({ ...t, y: t.y + pan_step });
					return;
				case "ArrowDown":
					e.preventDefault?.();
					apply_clamped({ ...t, y: t.y - pan_step });
					return;
				case "ArrowLeft":
					e.preventDefault?.();
					apply_clamped({ ...t, x: t.x + pan_step });
					return;
				case "ArrowRight":
					e.preventDefault?.();
					apply_clamped({ ...t, x: t.x - pan_step });
					return;
				case "+":
				case "=":
					e.preventDefault?.();
					step_level(1);
					return;
				case "-":
				case "_":
					e.preventDefault?.();
					step_level(-1);
					return;
				case "0":
					e.preventDefault?.();
					fit();
					return;
				default:
					return;
			}
		};

		const dispose = () => {
			cancel_animation();
			cancel_wheel_settle();
			dispose_root();
		};

		return {
			transform,
			level,
			is_moving,
			on_wheel,
			on_pointer_down,
			on_pointer_move,
			on_pointer_up,
			zoom_to,
			zoom_in: (anchor?: Point) => step_level(1, anchor),
			zoom_out: (anchor?: Point) => step_level(-1, anchor),
			fit,
			set_content_bounds,
			set_viewport,
			handle_key,
			dispose,
		};
	});
}
