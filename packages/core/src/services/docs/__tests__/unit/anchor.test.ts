import { describe, expect, test } from "bun:test";
import type { ThreadAnchor } from "@devpad/schema/validation";
import { resolve_anchor } from "../../anchor.js";

const BASE_TEXT = "The quick brown fox jumps over the lazy dog.";

function anchor_for(quote: string): ThreadAnchor {
	const start = BASE_TEXT.indexOf(quote);
	if (start === -1) throw new Error(`fixture bug: '${quote}' not found in BASE_TEXT`);
	const end = start + quote.length;
	return {
		quote,
		prefix: BASE_TEXT.slice(Math.max(0, start - 10), start),
		suffix: BASE_TEXT.slice(end, end + 10),
		start,
		end,
	};
}

describe("resolve_anchor — re-anchor verify-then-fallback (task A4.2)", () => {
	test("resolves via offsets when nothing changed", () => {
		const anchor = anchor_for("brown fox");
		const result = resolve_anchor(BASE_TEXT, anchor);
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.via).toBe("offsets");
		expect(BASE_TEXT.slice(result.start, result.end)).toBe("brown fox");
	});

	test("an edit BEFORE the span shifts offsets but the quote+context still resolves it", () => {
		const anchor = anchor_for("brown fox");
		const edited = "Once upon a time, " + BASE_TEXT;
		const result = resolve_anchor(edited, anchor);
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(edited.slice(result.start, result.end)).toBe("brown fox");
	});

	test("an edit AFTER the span never affects resolution", () => {
		const anchor = anchor_for("brown fox");
		const edited = BASE_TEXT + " And then it ran away.";
		const result = resolve_anchor(edited, anchor);
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(edited.slice(result.start, result.end)).toBe("brown fox");
	});

	test("an edit INSIDE the exact quoted span, with the quote text gone entirely, orphans rather than silently moving", () => {
		const anchor = anchor_for("brown fox");
		const edited = BASE_TEXT.replace("brown fox", "grey wolf");
		const result = resolve_anchor(edited, anchor);
		expect(result.status).toBe("orphaned");
	});

	test("falls back to a bare quote search when the surrounding prefix/suffix context changed", () => {
		const anchor = anchor_for("brown fox");
		// Prefix context changed (different word before it) but the quote itself is intact and unique.
		const edited = BASE_TEXT.replace("The quick brown fox", "A very fast brown fox");
		const result = resolve_anchor(edited, anchor);
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.via).toBe("quote");
		expect(edited.slice(result.start, result.end)).toBe("brown fox");
	});

	test("orphans when the quote no longer appears anywhere in the document", () => {
		const anchor = anchor_for("brown fox");
		const result = resolve_anchor("Completely different content.", anchor);
		expect(result.status).toBe("orphaned");
	});
});
