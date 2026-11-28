/** Runtime-checked narrowing of untrusted JSON to a plain object — a type guard, not an assertion. */
export const is_record = (input: unknown): input is Record<string, unknown> =>
	typeof input === "object" && input !== null && !Array.isArray(input);
