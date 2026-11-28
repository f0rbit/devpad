import { err, ok, type Result } from "@f0rbit/corpus";

export type ApiResultError = {
	message: string;
	code?: string;
	status_code?: number;
};

export type ApiResult<T> = Result<T, ApiResultError>;

// HTTP client errors (from `fetch`, third-party SDKs, etc.) aren't typed --
// narrow structurally instead of trusting a shape via `any`/`as`.
const field_of = (value: unknown, key: string): unknown => {
	if (typeof value !== "object" || value === null) return undefined;
	const field: unknown = Reflect.get(value, key);
	return field;
};

const string_field = (value: unknown, key: string): string | undefined => {
	const field = field_of(value, key);
	return typeof field === "string" ? field : undefined;
};

const number_field = (value: unknown, key: string): number | undefined => {
	const field = field_of(value, key);
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
