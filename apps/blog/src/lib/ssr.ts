import { err, ok, type Result } from "@f0rbit/corpus";

type ApiError = { message: string; status: number };
type ApiResult<T> = Result<T, ApiError>;
type SSRRuntime = { env?: { API_HANDLER?: { fetch: (request: Request) => Promise<Response> } } };

async function ssr<T>(path: string, request: Request, options: RequestInit = {}, runtime?: SSRRuntime): Promise<ApiResult<T>> {
	try {
		const cookie = request.headers.get("cookie") ?? "";
		const baseUrl = import.meta.env.DEV ? "http://localhost:8080" : new URL(request.url).origin;
		const url = new URL(path, baseUrl);

		const headers: Record<string, string> = {
			...(options.headers as Record<string, string>),
		};
		if (cookie) headers.Cookie = cookie;

		const api_handler = runtime?.env?.API_HANDLER;
		const req = new Request(url.toString(), { ...options, headers });
		const response = api_handler ? await api_handler.fetch(req) : await fetch(url.toString(), { ...options, headers });

		if (!response.ok) {
			const body = await response.json().catch(() => ({ message: "Unknown error" }));
			return err({
				message: (body as { message?: string }).message ?? `HTTP ${response.status}`,
				status: response.status,
			});
		}

		return ok((await response.json()) as T);
	} catch (e) {
		return err({
			message: e instanceof Error ? e.message : "Network error",
			status: 0,
		});
	}
}

export { ssr, type ApiResult, type SSRRuntime };
