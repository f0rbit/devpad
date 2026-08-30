/**
 * Best-effort SSR-time mobile detection for the canvas/outline home split
 * (P4.3). Deliberately a UA sniff, not a viewport measurement — Astro
 * decides which island (`CanvasSurface` vs `Outline`) to even MENTION in the
 * server-rendered markup, and only a mentioned island's client bundle is
 * shipped. A resize-based check can't run before the page paints, so it
 * can't gate which script tag goes out; UA sniffing can. Known tradeoff:
 * resizing a desktop window below 720px doesn't retroactively swap to the
 * outline (unlike the pure-CSS `≤720px` reflow the outline itself already
 * had) — a real mobile device's UA is the case this actually needs to cover.
 */
const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i;

export function isMobileUserAgent(userAgent: string | null): boolean {
	if (!userAgent) return false;
	return MOBILE_UA_PATTERN.test(userAgent);
}
