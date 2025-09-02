import { ArrayBufferedQueue, type BufferedQueue } from "@devpad/schema";
import { ApiError, AuthenticationError, NetworkError } from "./errors";
import { handleHttpResponse, handleResponseError, handleNetworkError, HTTP_STATUS } from "./error-handlers";

export type RequestOptions = {
	method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
	headers?: Record<string, string>;
	body?: unknown;
	query?: Record<string, string>;
};

export type RequestHistoryEntry = {
	timestamp: string;
	method: string;
	path: string;
	options: RequestOptions;
	url: string;
	status?: number;
	duration?: number;
	error?: string;
};

export class ApiClient {
	private base_url: string;
	private api_key: string;
	private request_history: BufferedQueue<RequestHistoryEntry>;

	constructor(options: { base_url: string; api_key: string; max_history_size?: number }) {
		if (!options.api_key) {
			throw new Error("API key is required");
		}

		if (options.api_key.length < 10) {
			throw new Error("API key is too short");
		}

		this.base_url = options.base_url;
		this.api_key = options.api_key;
		this.request_history = new ArrayBufferedQueue<RequestHistoryEntry>(options.max_history_size ?? 5);
	}

	private buildUrl(path: string, query?: Record<string, string>): string {
		const url = new URL(`${this.base_url}${path}`);

		if (query) {
			Object.entries(query).forEach(([key, value]) => {
				if (value) url.searchParams.append(key, value);
			});
		}

		return url.toString();
	}

	private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
		const { method = "GET", headers = {}, body, query } = options;

		const url = this.buildUrl(path, query);
		const startTime = Date.now();
		const timestamp = new Date().toISOString();

		const request_headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.api_key}`,
			...headers,
		};

		// Initialize history entry
		const historyEntry: RequestHistoryEntry = {
			timestamp,
			method,
			path,
			options: { ...options, method },
			url,
		};

		try {
			// console.log(`API Request: ${method} ${url}`);

			const fetchOptions: RequestInit = {
				method,
				headers: request_headers,
			};

			if (body) {
				fetchOptions.body = JSON.stringify(body);
			}

			const response = await fetch(url, fetchOptions);
			const duration = Date.now() - startTime;

			// console.log(`API Response Status: ${response.status}`);

			// Update history entry with response info
			historyEntry.status = response.status;
			historyEntry.duration = duration;

			if (!response.ok) {
				try {
					// Use centralized error handling
					handleHttpResponse(response);
					// If no exception thrown, handle with response error
					await handleResponseError(response);
				} catch (error) {
					// Log error in history and re-throw
					const errorMessage = error instanceof Error ? error.message : "Request failed";
					historyEntry.error = errorMessage;
					this.request_history.add(historyEntry);
					throw error;
				}
			}

			// Success - add to history
			this.request_history.add(historyEntry);

			// If the response doesn't have a body (like for delete methods), return void
			if (response.status === 204) {
				return undefined as T;
			}

			// Get the response text first
			const text = await response.text();

			// If the response is null, empty, or just whitespace, return undefined for void endpoints
			if (!text || text.trim() === "" || text.trim() === "null") {
				return undefined as T;
			}

			// Try to parse as JSON
			try {
				return JSON.parse(text) as T;
			} catch (parseError) {
				// If JSON parsing fails, return the text as-is
				return text as T;
			}
		} catch (error) {
			console.error("API Request Error:", error);

			// If this is a network error (not handled above), add to history
			if (!(error instanceof ApiError || error instanceof AuthenticationError)) {
				const duration = Date.now() - startTime;
				historyEntry.duration = duration;

				try {
					handleNetworkError(error);
				} catch (networkError) {
					const errorMessage = networkError instanceof Error ? networkError.message : "Unknown network error";
					historyEntry.error = errorMessage;
					this.request_history.add(historyEntry);
					throw networkError;
				}
			}

			// Re-throw API errors (already added to history above)
			throw error;
		}
	}

	public get<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
		return this.request(path, { ...options, method: "GET" });
	}

	public post<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
		return this.request(path, { ...options, method: "POST" });
	}

	public patch<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
		return this.request(path, { ...options, method: "PATCH" });
	}

	public put<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
		return this.request(path, { ...options, method: "PUT" });
	}

	public delete<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
		return this.request(path, { ...options, method: "DELETE" });
	}

	public history() {
		return this.request_history;
	}
}
