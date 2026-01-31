import { ApiClient, type ApiResult } from "@devpad/api";

function getCookie(name: string): string | undefined {
	if (typeof document === "undefined") return undefined;
	const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match?.[1];
}

function createClient(): ApiClient {
	const jwt = getCookie("devpad_jwt") ?? "";
	return new ApiClient({
		base_url: "/api/v1",
		api_key: jwt,
		auth_mode: "session",
		credentials: "same-origin",
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
