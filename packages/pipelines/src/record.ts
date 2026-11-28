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
