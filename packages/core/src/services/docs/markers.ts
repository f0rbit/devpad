/**
 * @module core/services/docs/markers
 *
 * v2.4 (task A4.2) — the annotation engine's marker format (locked decision
 * 3 + option C1: inline paired range markers). Pure string transforms only
 * — no I/O, no corpus, tests entirely in-memory with zero seams.
 *
 * Format: `<!-- devpad:thread:begin <id> <base64(JSON)> --> … <!-- devpad:thread:end <id> -->`.
 * The plan's ideation sketch shows the JSON inline as raw comment text; this
 * module base64-encodes it instead — standard base64's alphabet
 * (`A-Za-z0-9+/=`) never contains `--`, so a thread reply body containing
 * literal `--` (routine in code snippets) can never accidentally terminate
 * the HTML comment early. The wire shape (paired comments carrying the full
 * `ThreadMarker` JSON, Zod-validated on read) is unchanged.
 */

import { type ThreadMarker, thread_marker } from "@devpad/schema/validation";

const BEGIN_KEYWORD = "devpad:thread:begin";
const END_KEYWORD = "devpad:thread:end";

const BEGIN_RE = /<!--\s*devpad:thread:begin\s+(\S+)\s+([A-Za-z0-9+/=]+)\s*-->/g;

function escape_regex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function end_re_for(id: string): RegExp {
	return new RegExp(`<!--\\s*${END_KEYWORD}\\s+${escape_regex(id)}\\s*-->`);
}

function encode_payload(marker: ThreadMarker): string {
	return Buffer.from(JSON.stringify(marker), "utf-8").toString("base64");
}

function decode_payload(payload: string): unknown {
	return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
}

export function begin_comment(marker: ThreadMarker): string {
	return `<!-- ${BEGIN_KEYWORD} ${marker.id} ${encode_payload(marker)} -->`;
}

export function end_comment(id: string): string {
	return `<!-- ${END_KEYWORD} ${id} -->`;
}

export type MarkerSpan = { index: number; length: number };
export type ParsedThread = { marker: ThreadMarker; begin: MarkerSpan; end: MarkerSpan };
export type OrphanReason = "unpaired_begin" | "malformed";
export type OrphanMarker = { id: string; marker: ThreadMarker | null; reason: OrphanReason; begin: MarkerSpan };
export type ParseResult = { threads: ParsedThread[]; orphans: OrphanMarker[] };

/**
 * Parses every `devpad:thread:begin` marker in `html`. A begin whose JSON
 * payload fails to decode or Zod-validate becomes a `malformed` orphan
 * (adversary checklist: a forged marker must never crash the parser or
 * corrupt state — it's rejected, not trusted). A begin with valid JSON but
 * no matching end becomes an `unpaired_begin` orphan — its full anchor
 * trifecta survives (carried in the JSON itself), so `anchor.ts` can still
 * attempt to recover it.
 */
export function parse_markers(html: string): ParseResult {
	const threads: ParsedThread[] = [];
	const orphans: OrphanMarker[] = [];

	BEGIN_RE.lastIndex = 0;
	let match: RegExpExecArray | null = BEGIN_RE.exec(html);
	while (match !== null) {
		const [full, id, payload] = match;
		const begin: MarkerSpan = { index: match.index, length: full.length };

		const parsed = decode_marker(id, payload);
		if (!parsed) {
			// `id`/`payload` are non-optional capture groups in `BEGIN_RE` (no
			// `?` quantifier) — a match guarantees both are present.
			orphans.push({ id, marker: null, reason: "malformed", begin });
			match = BEGIN_RE.exec(html);
			continue;
		}

		const end_re = end_re_for(id);
		end_re.lastIndex = begin.index + begin.length;
		const end_match = end_re.exec(html);
		if (!end_match) {
			orphans.push({ id: parsed.id, marker: parsed, reason: "unpaired_begin", begin });
			match = BEGIN_RE.exec(html);
			continue;
		}

		threads.push({
			marker: parsed,
			begin,
			end: { index: end_match.index, length: end_match[0].length },
		});
		match = BEGIN_RE.exec(html);
	}

	return { threads, orphans };
}

function decode_marker(id: string | undefined, payload: string | undefined): ThreadMarker | null {
	if (!id || !payload) return null;
	try {
		const decoded = decode_payload(payload);
		const result = thread_marker.safeParse(decoded);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

const MARKER_COMMENT_RE = new RegExp(
	`<!--\\s*devpad:thread:(?:begin\\s+\\S+\\s+[A-Za-z0-9+/=]+|end\\s+\\S+)\\s*-->`,
	"g",
);

/**
 * Removes every marker comment (paired, unpaired, or malformed) from `html`,
 * returning the marker-free content plus a per-character index map from
 * `stripped` offsets back to `html` offsets. The map is what lets
 * `embed_marker` translate a position computed against clean content back
 * into the right spot in a doc that may already contain other markers.
 */
export function strip_markers(html: string): { stripped: string; index_map: number[] } {
	let stripped = "";
	const index_map: number[] = [];
	let cursor = 0;

	MARKER_COMMENT_RE.lastIndex = 0;
	let match: RegExpExecArray | null = MARKER_COMMENT_RE.exec(html);
	while (match !== null) {
		for (let i = cursor; i < match.index; i++) {
			stripped += html[i];
			index_map.push(i);
		}
		cursor = match.index + match[0].length;
		match = MARKER_COMMENT_RE.exec(html);
	}
	for (let i = cursor; i < html.length; i++) {
		stripped += html[i];
		index_map.push(i);
	}

	return { stripped, index_map };
}

function raw_insert_offset(html: string, index_map: number[], stripped_length: number, pos: number): number {
	if (pos < stripped_length) return index_map[pos] ?? html.length;
	return html.length;
}

/**
 * Embeds `marker` as a fresh begin/end pair bracketing `[range.start, range.end)`,
 * where the range is expressed in STRIPPED coordinates (the clean content
 * view, independent of any markers `html` may already contain). Safe to
 * call repeatedly against a doc that already has other markers — `strip_markers`
 * is recomputed fresh each call, so `range` always resolves against the
 * same clean content regardless of what's already embedded.
 */
export function embed_marker(html: string, marker: ThreadMarker, range: { start: number; end: number }): string {
	const { stripped, index_map } = strip_markers(html);
	const raw_end = raw_insert_offset(html, index_map, stripped.length, range.end);
	const raw_start = raw_insert_offset(html, index_map, stripped.length, range.start);

	// Insert the END marker first (higher raw offset) so its insertion never
	// shifts the still-pending BEGIN insertion point.
	const with_end = html.slice(0, raw_end) + end_comment(marker.id) + html.slice(raw_end);
	return with_end.slice(0, raw_start) + begin_comment(marker) + with_end.slice(raw_start);
}

/**
 * v2.4 (B3 fast-follow #4, taste/IA critic — "anchor connection") — the
 * render route used to just `strip_markers` every marker comment away, so a
 * rendered doc had no DOM hook for the annotation rail to scroll/flash a
 * thread's anchored text against. This wraps each PAIRED thread's bracketed
 * content in `<mark data-thread-id="...">` instead of stripping it, then
 * strips whatever's left (orphans — no target range to wrap). Processed
 * right-to-left (by `begin.index`, descending) against the ORIGINAL parsed
 * offsets so each replacement — confined to `[begin.index, end.index + end.length)`
 * — never shifts a still-pending, lower-index thread's recorded offsets.
 */
export function markers_to_marks(html: string): string {
	const { threads } = parse_markers(html);
	const wrapped = threads
		.toSorted((a: ParsedThread, b: ParsedThread) => b.begin.index - a.begin.index)
		.reduce((acc: string, t: ParsedThread) => {
			const before = acc.slice(0, t.begin.index);
			const bracketed = acc.slice(t.begin.index + t.begin.length, t.end.index);
			const after = acc.slice(t.end.index + t.end.length);
			return `${before}<mark data-thread-id="${t.marker.id}">${bracketed}</mark>${after}`;
		}, html);
	return strip_markers(wrapped).stripped;
}

/**
 * Swaps a paired thread's JSON payload in place (reply/resolve/toggle-blocking)
 * without touching the bracketed content or its position. Returns `null` if
 * `thread_id` isn't currently PAIRED — an orphan (unpaired begin, no anchor
 * range to preserve) goes through `replace_orphan_marker` instead; see
 * `threads.ts`'s `mutate_thread`, which tries both.
 */
export function replace_marker(html: string, thread_id: string, updated: ThreadMarker): string | null {
	const { threads } = parse_markers(html);
	const found = threads.find((t) => t.marker.id === thread_id);
	if (!found) return null;

	const before = html.slice(0, found.begin.index);
	const bracketed = html.slice(found.begin.index + found.begin.length, found.end.index);
	const after = html.slice(found.end.index + found.end.length);
	return before + begin_comment(updated) + bracketed + end_comment(updated.id) + after;
}

/**
 * v2.4 (B3 fast-follow #7, taste/IA critic — "visible must not mean
 * dead-ended") — an orphaned thread (its anchored text wasn't found on the
 * last reconcile) has no bracketed range to preserve, only a dangling begin
 * comment (see `threads.ts`'s `reconcile()`). Swaps its JSON payload in
 * place the same way `replace_marker` does for a paired thread, so reply/
 * resolve/toggle-blocking all work on an orphan without requiring it to
 * re-anchor first. Returns `null` if `thread_id` isn't a currently-orphaned
 * marker.
 */
export function replace_orphan_marker(html: string, thread_id: string, updated: ThreadMarker): string | null {
	const { orphans } = parse_markers(html);
	const found = orphans.find((o) => o.marker?.id === thread_id);
	if (!found) return null;

	const before = html.slice(0, found.begin.index);
	const after = html.slice(found.begin.index + found.begin.length);
	return before + begin_comment(updated) + after;
}
