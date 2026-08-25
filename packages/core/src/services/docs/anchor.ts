/**
 * @module core/services/docs/anchor
 *
 * v2.4 (task A4.2) — re-anchoring: verify → offsets → fuzzy quote → orphan,
 * always validated against the stored quote (architecture-decisions). Pure,
 * operates on the STRIPPED (marker-free) text view — the same content a
 * human or agent actually reads.
 */

import type { ThreadAnchor } from "@devpad/schema/validation";

export type AnchorResolution =
	| { status: "ok"; start: number; end: number; via: "offsets" | "quote" }
	| { status: "orphaned"; reason: "not_found" };

/**
 * `offsets`: the stored `start`/`end` still land on exactly `quote` — the
 * common case when nothing (or only unrelated content elsewhere) changed.
 *
 * `quote` (fuzzy fallback): search for `prefix + quote + suffix` together
 * first (disambiguates a quote that appears more than once), then fall back
 * to a bare `quote` search. Either way the match is always the literal
 * stored quote text — never a "close enough" heuristic that could silently
 * attach a thread to the wrong content.
 *
 * Anything else: `orphaned` — never silently moved.
 */
export function resolve_anchor(content: string, anchor: ThreadAnchor): AnchorResolution {
	if (anchor.start >= 0 && anchor.end <= content.length && anchor.start < anchor.end) {
		if (content.slice(anchor.start, anchor.end) === anchor.quote) {
			return { status: "ok", start: anchor.start, end: anchor.end, via: "offsets" };
		}
	}

	const combined = anchor.prefix + anchor.quote + anchor.suffix;
	const combined_index = combined.length > 0 ? content.indexOf(combined) : -1;
	if (combined_index >= 0) {
		const start = combined_index + anchor.prefix.length;
		return { status: "ok", start, end: start + anchor.quote.length, via: "quote" };
	}

	const quote_index = content.indexOf(anchor.quote);
	if (quote_index >= 0) {
		return { status: "ok", start: quote_index, end: quote_index + anchor.quote.length, via: "quote" };
	}

	return { status: "orphaned", reason: "not_found" };
}
