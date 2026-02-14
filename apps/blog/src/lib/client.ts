import { ApiClient, type ApiResult } from "@devpad/api";

function createClient(): ApiClient {
	return new ApiClient({
		base_url: `${window.location.origin}/api/v1`,
		auth_mode: "cookie",
		credentials: "include",
	});
}

let _client: ApiClient | null = null;

export function getClient(): ApiClient {
	if (!_client) _client = createClient();
	return _client;
}

export function unwrap<T>(result: ApiResult<T>): T {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}
