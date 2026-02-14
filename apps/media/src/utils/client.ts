import { ApiClient } from "@devpad/api";
import { isDevMode, MOCK_API_KEY } from "./mock-auth";

const API_HOST = import.meta.env.PUBLIC_API_URL || "";

function createClient(api_key?: string): ApiClient {
	const key = api_key ?? (isDevMode() ? MOCK_API_KEY : "");
	return new ApiClient({
		base_url: `${API_HOST}/api/v1`,
		api_key: key,
		auth_mode: "key",
		credentials: "include",
	});
}

let _client: ApiClient | null = null;

function getClient(): ApiClient {
	if (!_client) _client = createClient();
	return _client;
}

function setApiKey(key: string): void {
	_client = createClient(key);
}

const normalizePath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

const apiUrls = {
	host: API_HOST,
	media: (path: string) => `${API_HOST}/api${normalizePath(path)}`,
	auth: (path: string) => `${API_HOST}/api/auth${normalizePath(path)}`,
	timeline: (path = "") => `${API_HOST}/api/v1/timeline${path ? normalizePath(path) : ""}`,
	connections: (path = "") => `${API_HOST}/api/v1/connections${path ? normalizePath(path) : ""}`,
	profiles: (path = "") => `${API_HOST}/api/v1/profiles${path ? normalizePath(path) : ""}`,
	me: () => `${API_HOST}/api/v1/me`,
};

export { apiUrls, createClient, getClient, setApiKey };
