import type { ApiResultError } from "@devpad/api";
import { getBrowserClient } from "@devpad/core/ui/client";

export function getApiClient() {
	return getBrowserClient();
}

export { getServerApiClient } from "@devpad/core/ui/api-client";

export function rethrow(error: ApiResultError) {
	return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}
