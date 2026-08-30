/**
 * Uniform-grid spatial index over laid-out node bounds — tldraw-style
 * culling, not Excalidraw's O(N)-per-frame scan. Built once per layout
 * change (`canvas-surface.tsx` rebuilds it inside the same memo that calls
 * `layout_graph`), then queried once per visible-set recompute against the
 * current viewport world rect.
 *
 * Cell size is a caller concern (kept ≈2x node size per the canvas UX
 * contract's node footprint) so this module stays layout-agnostic — it only
 * ever sees plain rects with an id.
 */

export type SpatialRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type SpatialItem = SpatialRect & { readonly id: string };
export type SpatialIndex = { readonly query: (rect: SpatialRect) => ReadonlySet<string> };

const cell_range = (
	start: number,
	size: number,
	cell_size: number,
): { readonly min: number; readonly max: number } => ({
	min: Math.floor(start / cell_size),
	max: Math.floor((start + size) / cell_size),
});

const cell_key = (cx: number, cy: number): string => `${String(cx)},${String(cy)}`;

export function build_spatial_index(items: readonly SpatialItem[], cell_size: number): SpatialIndex {
	const cells = new Map<string, string[]>();

	for (const item of items) {
		const cols = cell_range(item.x, item.w, cell_size);
		const rows = cell_range(item.y, item.h, cell_size);
		for (let cx = cols.min; cx <= cols.max; cx++) {
			for (let cy = rows.min; cy <= rows.max; cy++) {
				const key = cell_key(cx, cy);
				const bucket = cells.get(key);
				if (bucket) bucket.push(item.id);
				else cells.set(key, [item.id]);
			}
		}
	}

	const query = (rect: SpatialRect): ReadonlySet<string> => {
		const cols = cell_range(rect.x, rect.w, cell_size);
		const rows = cell_range(rect.y, rect.h, cell_size);
		const result = new Set<string>();
		for (let cx = cols.min; cx <= cols.max; cx++) {
			for (let cy = rows.min; cy <= rows.max; cy++) {
				const bucket = cells.get(cell_key(cx, cy));
				if (!bucket) continue;
				for (const id of bucket) result.add(id);
			}
		}
		return result;
	};

	return { query };
}
