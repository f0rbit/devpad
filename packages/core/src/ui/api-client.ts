import ApiClient from "@devpad/api";

const SESSION_SENTINELS = new Set(["injected", "verified"]);

interface AstroLocals {
	session: { id: string } | null;
	runtime?: {
		env?: {
			__api?: { fetch: (request: Request, env: any, ctx: any) => Promise<Response> };
			API_URL?: string;
			[key: string]: unknown;
		};
		ctx?: { waitUntil: (promise: Promise<unknown>) => void; passThroughOnException: () => void };
	};
}

export function getServerApiClient(locals: AstroLocals): ApiClient {
	const runtime = locals.runtime;
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
		? ((async (input: string | Request, init?: RequestInit): Promise<Response> => {
				const request = new Request(input as string, init);
				const ctx = runtime?.ctx ?? { waitUntil: () => {}, passThroughOnException: () => {} };
				return api_app.fetch(request, runtime?.env, ctx);
			}) as unknown as typeof fetch)
		: undefined;

	return new ApiClient({
		base_url: api_url,
		auth_mode: "cookie",
		credentials: "include",
		default_headers,
		custom_fetch,
	});
}
