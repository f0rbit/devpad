import { err, ok, type Result } from "@f0rbit/corpus";

export type ApiResultError = {
	message: string;
	code?: string;
	status_code?: number;
};

export type ApiResult<T> = Result<T, ApiResultError>;

// HTTP client errors (from `fetch`, third-party SDKs, etc.) aren't typed --
// narrow structurally instead of trusting a shape via `any`/`as`.
const string_field = (value: unknown, key: string): string | undefined => {
	if (typeof value !== "object" || value === null || !(key in value)) return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" ? field : undefined;
};

const number_field = (value: unknown, key: string): number | undefined => {
	if (typeof value !== "object" || value === null || !(key in value)) return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "number" ? field : undefined;
};

export function wrap<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
	return fn()
		.then((data) => ok(data))
		.catch((error: unknown) =>
			err({
				message: error instanceof Error ? error.message : "Unknown error",
				code: string_field(error, "code"),
				status_code: number_field(error, "statusCode") ?? number_field(error, "status_code"),
			}),
		);
}

export { ok, err, type Result };
