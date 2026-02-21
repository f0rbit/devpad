import type { ApiResult } from "@devpad/api";
import { getBrowserClient } from "@devpad/core/ui/client";

export function getClient() {
	return getBrowserClient();
}

export function unwrap<T>(result: ApiResult<T>): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}
