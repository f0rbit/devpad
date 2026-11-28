import { try_catch_async } from "@f0rbit/corpus";

/** Runtime-checked narrowing of untrusted JSON to a plain object — a type guard, not an assertion. */
export const is_record = (input: unknown): input is Record<string, unknown> =>
	typeof input === "object" && input !== null && !Array.isArray(input);

/**
 * Read a request body as untrusted `unknown`. Hono's `c.req.json()` is typed
 * `Promise<any>`; routing it through this structural param type drops the
 * `any` at the boundary. A malformed/empty body reads as `null` — every
 * caller feeds the result straight into a Zod `safeParse`, which rejects it.
 */
export const read_json = async (req: { json(): Promise<unknown> }): Promise<unknown> => {
	const body = await try_catch_async(
		() => req.json(),
		(cause) => String(cause),
	);
	return body.ok ? body.value : null;
};

/**
 * Normalise any `HeadersInit` shape (a `Headers` instance, a tuple list, a
 * plain record) to string pairs. Takes `unknown` on purpose: this package
 * loads both workers-types and bun-types globals, whose `HeadersInit`
 * declarations differ, so the caller's type can't be relied on — runtime
 * checks narrow instead (a spread of a `Headers` instance silently drops
 * entries, hence the explicit normalisation).
 */
export const header_pairs = (headers: unknown): Array<[string, string]> => {
	if (headers === undefined || headers === null) return [];
	if (headers instanceof Headers) return [...headers.entries()];
	const pairs: Array<[string, string]> = [];
	if (Array.isArray(headers)) {
		for (const item of headers) {
			const entry: unknown = item;
			if (!Array.isArray(entry)) continue;
			const key: unknown = entry[0];
			const value: unknown = entry[1];
			if (typeof key === "string" && typeof value === "string") pairs.push([key, value]);
		}
		return pairs;
	}
	if (!is_record(headers)) return pairs;
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string") pairs.push([key, value]);
	}
	return pairs;
};
