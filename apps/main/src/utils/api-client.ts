import type { ApiResultError } from "@devpad/api";

export function rethrow(error: ApiResultError) {
	return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}
