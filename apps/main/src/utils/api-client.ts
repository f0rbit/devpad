import ApiClient, { type ApiResultError } from "@devpad/api";

let _client: ApiClient | null = null;

export function getApiClient(): ApiClient {
	if (_client) return _client;

	const server_url = `${window.location.origin}/api/v1`;
	_client = new ApiClient({
		base_url: server_url,
		auth_mode: "cookie",
		credentials: "include",
	});
	return _client;
}

export function getServerApiClient(locals: any): ApiClient {
	if (!process.env.PUBLIC_API_SERVER_URL) throw new Error("PUBLIC_API_SERVER_URL is not set");

	return new ApiClient({
		base_url: process.env.PUBLIC_API_SERVER_URL,
		auth_mode: "cookie",
		credentials: "include",
	});
}

export function rethrow(error: ApiResultError) {
	return new Response(error?.code, { status: error?.status_code, statusText: error?.code });
}
