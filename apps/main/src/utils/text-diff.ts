/**
 * @module utils/text-diff
 *
 * v2.4 (B3.1 doc version diff, B3.3 interface-report diff) — a small,
 * dependency-free line-based LCS diff. Shared by the DocViewer's
 * adjacent-version diff link and the checkpoint card's interface-report
 * diff view, so both render the same visual diff language.
 */

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

/** Standard O(n*m) LCS table diff — fine at doc/declaration-file line counts (tens to low hundreds of lines), never called on request-hot paths. */
export function diffLines(oldText: string, newText: string): DiffLine[] {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");

	const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
		Array.from({ length: newLines.length + 1 }, () => 0),
	);
	for (let i = oldLines.length - 1; i >= 0; i--) {
		for (let j = newLines.length - 1; j >= 0; j--) {
			table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}

	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			result.push({ kind: "same", text: oldLines[i] });
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			result.push({ kind: "remove", text: oldLines[i] });
			i++;
		} else {
			result.push({ kind: "add", text: newLines[j] });
			j++;
		}
	}
	while (i < oldLines.length) {
		result.push({ kind: "remove", text: oldLines[i] });
		i++;
	}
	while (j < newLines.length) {
		result.push({ kind: "add", text: newLines[j] });
		j++;
	}
	return result;
}

/**
 * v2.4 (B3 fast-follow #3, taste/IA critic) — the DocViewer's adjacent-
 * version diff link was diffing raw stored HTML line-by-line: annotation
 * markers embed as `<!-- devpad:thread:begin … base64(JSON) -->` (see
 * `@devpad/core`'s `markers.ts`), so two versions minted a beat apart by the
 * annotation engine diffed almost entirely as base64 blob noise. Client-side
 * mirror of the server's `strip_markers` regex (kept dependency-free —
 * `markers.ts`'s own version needs `Buffer` for the JSON payload, which this
 * display-only strip doesn't) plus, for `plan`/`design` HTML, a block-
 * boundary-aware tag strip so the diff reads as prose. `interface` docs are
 * already escaped plain text (`push_interface_report`) — diffed as-is.
 */
const MARKER_COMMENT_RE = /<!--\s*devpad:thread:(?:begin\s+\S+\s+[A-Za-z0-9+/=]+|end\s+\S+)\s*-->/g;
const BLOCK_BOUNDARY_RE = /<\/(p|h1|h2|h3|h4|h5|h6|li|div|tr|blockquote|pre)>|<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const ENTITY_UNESCAPES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const ENTITY_RE = /&(amp|lt|gt|quot|#39);/g;

export function docContentForDiff(html: string, kind: "plan" | "design" | "interface"): string {
	const withoutMarkers = html.replace(MARKER_COMMENT_RE, "");
	if (kind === "interface") return withoutMarkers;
	return withoutMarkers
		.replace(BLOCK_BOUNDARY_RE, "\n")
		.replace(TAG_RE, "")
		.replace(ENTITY_RE, (_match, entity: string) => ENTITY_UNESCAPES[entity] ?? _match)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n");
}
