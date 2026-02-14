import ApiClient from "@devpad/api";

const SESSION_SENTINELS = new Set(["injected", "verified"]);

export function getServerApiClient(locals: App.Locals): ApiClient {
	const runtime = (locals as any).runtime;
	const api_app = runtime?.env?.__api;
	const base_url = process.env.PUBLIC_API_SERVER_URL || runtime?.env?.API_URL || "";

	if (!base_url) throw new Error("No API server URL available");

	const api_url = base_url.endsWith("/api/v1") ? base_url : `${base_url}/api/v1`;
	const session_id = locals.session?.id;
	const default_headers: Record<string, string> = {};

	if (session_id && !SESSION_SENTINELS.has(session_id)) {
		default_headers.Cookie = `auth_session=${session_id}`;
	}

	const custom_fetch = api_app
		? async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
				const request = new Request(input, init);
				const ctx = runtime.ctx ?? { waitUntil: () => {}, passThroughOnException: () => {} };
				return api_app.fetch(request, runtime.env, ctx);
			}
		: undefined;

	return new ApiClient({
		base_url: api_url,
		auth_mode: "cookie",
		credentials: "include",
		default_headers,
		custom_fetch,
	});
}
