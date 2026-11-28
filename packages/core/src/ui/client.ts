import { ApiClient } from "@devpad/api";

let client_instance: ApiClient | null = null;

export function getBrowserClient(baseUrl?: string): ApiClient {
	if (client_instance) return client_instance;

	const host = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
	client_instance = new ApiClient({
		base_url: `${host}/api/v1`,
		auth_mode: "cookie",
		credentials: "include",
	});
	return client_instance;
}
