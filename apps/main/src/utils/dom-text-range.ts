/**
 * @module utils/dom-text-range
 *
 * v2.4 (B3.2) — plain-text ⇄ DOM Range conversion for the annotation
 * engine's client side. The server's `ThreadAnchor` (quote + prefix/suffix +
 * start/end) is validated by `resolve_anchor` with a "verifies-then-falls-
 * back" chain (offsets → combined quote+prefix+suffix → bare quote —
 * see `packages/core/src/services/docs/anchor.ts`), always against the
 * STRIPPED HTML STRING (tags included). The browser's `Selection`/`Range`
 * API only ever sees RENDERED plain text (no tags) — there is no reliable
 * client-side way to recover raw-HTML-source offsets from a DOM Range. We
 * deliberately don't try: `quote` (the literal selected text, which by
 * construction never straddles a tag boundary) and the surrounding ~32
 * plain-text characters are computed here and sent as-is. The server's bare
 * `content.indexOf(quote)` fallback resolves them correctly for the common
 * case (a quote that appears once); a quote appearing more than once in a
 * doc resolves to its first occurrence — the same accepted, documented
 * quote-based-anchoring limitation the server side already lives with, not
 * a client-side bug to work around here.
 */

const CONTEXT_CHARS = 32;

function walkTextOffset(root: Node, target: Node, targetOffset: number): number {
	const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let total = 0;
	let current = walker.nextNode();
	while (current) {
		if (current === target) return total + targetOffset;
		total += current.textContent?.length ?? 0;
		current = walker.nextNode();
	}
	return total;
}

export type PlainTextAnchor = { quote: string; prefix: string; suffix: string; start: number; end: number };

/** Converts a live `Range` (from `Selection.getRangeAt(0)`) into a plain-text anchor relative to `root`. Returns `null` for an empty/collapsed selection. */
export function anchorFromRange(root: HTMLElement, range: Range): PlainTextAnchor | null {
	const quote = range.toString();
	if (quote.length === 0) return null;

	const text = root.textContent;
	const start = walkTextOffset(root, range.startContainer, range.startOffset);
	const end = walkTextOffset(root, range.endContainer, range.endOffset);

	return {
		quote,
		prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
		suffix: text.slice(end, end + CONTEXT_CHARS),
		start,
		end,
	};
}

/** Reverse of the text-offset walk: builds a live `Range` spanning `[start, end)` plain-text characters within `root`. Returns `null` if the offsets run past the end of `root`'s text. */
export function rangeFromTextOffsets(root: HTMLElement, start: number, end: number): Range | null {
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let total = 0;
	let startNode: Node | null = null;
	let startOffset = 0;
	let endNode: Node | null = null;
	let endOffset = 0;

	let current = walker.nextNode();
	while (current) {
		const len = current.textContent?.length ?? 0;
		if (startNode === null && total + len >= start) {
			startNode = current;
			startOffset = start - total;
		}
		if (total + len >= end) {
			endNode = current;
			endOffset = end - total;
			break;
		}
		total += len;
		current = walker.nextNode();
	}
	if (!startNode || !endNode) return null;

	const range = root.ownerDocument.createRange();
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);
	return range;
}

/** Locates a thread's stored quote in the CURRENTLY rendered `root` (first occurrence — see module doc) and returns its bounding rect, for margin-rail vertical alignment. `null` when the quote isn't found (the thread is orphaned in this render). */
export function findQuoteRect(root: HTMLElement, quote: string): DOMRect | null {
	const text = root.textContent;
	const idx = text.indexOf(quote);
	if (idx === -1) return null;
	const range = rangeFromTextOffsets(root, idx, idx + quote.length);
	return range ? range.getBoundingClientRect() : null;
}
