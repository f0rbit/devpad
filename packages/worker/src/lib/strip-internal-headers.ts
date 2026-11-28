const INTERNAL_PREFIXES = ["x-auth-", "x-devpad-"];
const INTERNAL_EXACT = ["x-test-user"];

const is_internal = (name: string): boolean => {
	const lower = name.toLowerCase();
	return INTERNAL_PREFIXES.some((p) => lower.startsWith(p)) || INTERNAL_EXACT.includes(lower);
};

/**
 * Edge hygiene: headers that downstream code (Astro SSR middleware, the
 * orchestrator proxy, e2e fake auth) treats as server-set trust signals can
 * never originate from a client. Strip them all before anything else looks
 * at the request; the edge re-adds the ones it vouches for after validating
 * a session. Returns the same request when there is nothing to strip.
 *
 * Deletes on a copy rather than `new Request(request, { headers })`: Bun ignores
 * an EMPTY `init.headers` and falls back to the original's headers, which
 * would silently keep a lone forged header.
 */
export const strip_internal_auth_headers = (request: Request): Request => {
	const names = Array.from(request.headers.keys()).filter(is_internal);
	if (names.length === 0) return request;
	const clean = new Request(request);
	names.forEach((name) => {
		clean.headers.delete(name);
	});
	return clean;
};
