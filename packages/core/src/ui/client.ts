import ApiClient from "@devpad/api";

let _client: ApiClient | null = null;

export function getBrowserClient(baseUrl?: string): ApiClient {
	if (_client) return _client;

	const host = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
	_client = new ApiClient({
		base_url: `${host}/api/v1`,
		auth_mode: "cookie",
		credentials: "include",
	});
	return _client;
}
