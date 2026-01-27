import { type Result, try_catch_async } from "@f0rbit/corpus";

type ApiHandler = {
	fetch: (request: Request) => Promise<Response>;
};

export type ApiError = {
	status: number;
	message: string;
};

type RuntimeEnv = {
	API_HANDLER?: ApiHandler;
};

export const api = {
	blog: (path: string) => `/api/v1/blog${path ? (path.startsWith("/") ? path : `/${path}`) : ""}`,

	auth: (path: string) => `/api/auth${path.startsWith("/") ? path : `/${path}`}`,

	async fetch(path: string, options: RequestInit = {}): Promise<Response> {
		return fetch(path, {
			...options,
			credentials: "same-origin",
		});
	},

	async json<T>(path: string, options?: RequestInit): Promise<T> {
		const res = await this.fetch(path, options);
		if (!res.ok) {
			const errorData = (await res.json().catch(() => ({}))) as { message?: string };
			throw new Error(errorData.message || `Request failed: ${res.status}`);
		}
		return res.json() as Promise<T>;
	},

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.json<T>(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async put<T>(path: string, body: unknown): Promise<T> {
		return this.json<T>(path, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async delete(path: string): Promise<void> {
		const res = await this.fetch(path, { method: "DELETE" });
		if (!res.ok) {
			const errorData = (await res.json().catch(() => ({}))) as { message?: string };
			throw new Error(errorData.message || `Delete failed: ${res.status}`);
		}
	},

	/** Result-based fetch that returns errors as values instead of throwing */
	async fetchResult<T>(path: string, options?: RequestInit): Promise<Result<T, ApiError>> {
		return try_catch_async(
			async () => {
				const res = await this.fetch(path, options);
				if (!res.ok) {
					const errorData = (await res.json().catch(() => ({}))) as { message?: string };
					throw { status: res.status, message: errorData.message || `Request failed: ${res.status}` };
				}
				return res.json() as Promise<T>;
			},
			(e): ApiError => {
				if (typeof e === "object" && e !== null && "status" in e) {
					return e as ApiError;
				}
				return { status: 0, message: e instanceof Error ? e.message : "Network error" };
			}
		);
	},

	async postResult<T>(path: string, body: unknown): Promise<Result<T, ApiError>> {
		return this.fetchResult<T>(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async putResult<T>(path: string, body: unknown): Promise<Result<T, ApiError>> {
		return this.fetchResult<T>(path, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	},

	async deleteResult(path: string): Promise<Result<void, ApiError>> {
		return try_catch_async(
			async () => {
				const res = await this.fetch(path, { method: "DELETE" });
				if (!res.ok) {
					const errorData = (await res.json().catch(() => ({}))) as { message?: string };
					throw { status: res.status, message: errorData.message || `Delete failed: ${res.status}` };
				}
			},
			(e): ApiError => {
				if (typeof e === "object" && e !== null && "status" in e) {
					return e as ApiError;
				}
				return { status: 0, message: e instanceof Error ? e.message : "Network error" };
			}
		);
	},

	/**
	 * Make an SSR request to the API.
	 * If running in the unified worker, uses direct internal call.
	 * Otherwise falls back to HTTP fetch.
	 */
	async ssr(path: string, request: Request, options: RequestInit = {}, runtime?: { env?: RuntimeEnv }): Promise<Response> {
		const cookie = request.headers.get("cookie") ?? "";

		// If we have access to the internal API handler, use it directly
		const apiHandler = runtime?.env?.API_HANDLER;
		if (apiHandler) {
			const url = new URL(path, request.url);
			const internalRequest = new Request(url.toString(), {
				...options,
				headers: {
					...options.headers,
					Cookie: cookie,
				},
			});
			return apiHandler.fetch(internalRequest);
		}

		// Fallback to HTTP fetch (for local dev or non-unified deployments)
		// In dev mode, API server runs on port 8080
		const baseUrl = import.meta.env.DEV ? "http://localhost:8080" : request.url;
		const url = new URL(path, baseUrl);
		return fetch(url.toString(), {
			...options,
			headers: {
				...options.headers,
				Cookie: cookie,
			},
		});
	},
};
