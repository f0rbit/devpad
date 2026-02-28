import type { ApiResult } from "@devpad/api";

export function unwrap<T>(result: ApiResult<T>): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}
