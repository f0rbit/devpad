import type { ApiClient } from "./request";

/**
 * Abstract base class for API clients
 * Provides common functionality and eliminates constructor duplication
 */
export abstract class BaseClient {
	protected apiClient: ApiClient;

	constructor(apiClient: ApiClient) {
		this.apiClient = apiClient;
	}

	/**
	 * Helper method for GET requests
	 */
	protected get<T>(path: string, options: Parameters<ApiClient["get"]>[1] = {}): Promise<T> {
		return this.apiClient.get<T>(path, options);
	}

	/**
	 * Helper method for POST requests
	 */
	protected post<T>(path: string, options: Parameters<ApiClient["post"]>[1] = {}): Promise<T> {
		return this.apiClient.post<T>(path, options);
	}

	/**
	 * Helper method for PATCH requests
	 */
	protected patch<T>(path: string, options: Parameters<ApiClient["patch"]>[1] = {}): Promise<T> {
		return this.apiClient.patch<T>(path, options);
	}

	/**
	 * Helper method for PUT requests
	 */
	protected put<T>(path: string, options: Parameters<ApiClient["put"]>[1] = {}): Promise<T> {
		return this.apiClient.put<T>(path, options);
	}

	/**
	 * Helper method for DELETE requests
	 */
	protected delete<T>(path: string, options: Parameters<ApiClient["delete"]>[1] = {}): Promise<T> {
		return this.apiClient.delete<T>(path, options);
	}

	/**
	 * Helper method for building query parameters
	 */
	protected buildQuery(params: Record<string, string | undefined>): Record<string, string> {
		const query: Record<string, string> = {};
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				query[key] = value;
			}
		}
		return query;
	}
}
