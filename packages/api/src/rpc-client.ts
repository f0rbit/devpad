import type { Project, ProjectConfig, TaskWithDetails, UpsertTag } from "@devpad/schema";
import type { ApiClient } from "./request";

/**
 * Central API route definitions - single source of truth for all endpoint types
 * This interface drives all type inference throughout the API client
 */
export interface ApiRoutes {
	// Auth routes
	"GET /auth/session": {
		authenticated: boolean;
		user: {
			id: string;
			name: string;
			email?: string;
			github_id: number;
			image_url?: string;
			task_view: string;
		} | null;
		session: { id: string } | null;
	};
	"GET /auth/login": void;
	"GET /auth/logout": void;
	"POST /auth/keys": { api_key: string };
	"DELETE /auth/keys": void;

	// Project routes
	"GET /projects": Project[];
	"GET /projects/public": Project[];
	"PATCH /projects": Project;
	"GET /projects/config": ProjectConfig | null;
	"PATCH /projects/save_config": void;
	"GET /projects/spec": string;

	// Task routes
	"GET /tasks": TaskWithDetails[];
	"PATCH /tasks": TaskWithDetails;
	"PATCH /tasks/save_tags": UpsertTag[];

	// Generic routes with parameters (handled specially)
	"GET /projects/by-name": Project;
	"GET /projects/by-id": Project;
	"GET /tasks/by-id": TaskWithDetails;
	"GET /tasks/by-project": TaskWithDetails[];
	"GET /tasks/by-tag": TaskWithDetails[];
}

/**
 * TypeScript utility types to extract route patterns by HTTP method
 */
export type ExtractGETRoutes<T> = Extract<keyof T, `GET ${string}`>;
export type ExtractPOSTRoutes<T> = Extract<keyof T, `POST ${string}`>;
export type ExtractPATCHRoutes<T> = Extract<keyof T, `PATCH ${string}`>;
export type ExtractDELETERoutes<T> = Extract<keyof T, `DELETE ${string}`>;

/**
 * RPC-style typed API client that provides automatic type inference
 * based on route definitions. No manual return type annotations needed.
 */
export class RpcClient<TRoutes = ApiRoutes> {
	constructor(private apiClient: ApiClient) {}

	/**
	 * Typed GET request - return type automatically inferred from TRoutes
	 */
	get<TRoute extends ExtractGETRoutes<TRoutes>>(route: TRoute extends `GET ${infer TPath}` ? TPath : never, options?: { query?: Record<string, string> }): Promise<TRoutes[TRoute]> {
		return this.apiClient.get(route as string, options);
	}

	/**
	 * Typed POST request - return type automatically inferred from TRoutes
	 */
	post<TRoute extends ExtractPOSTRoutes<TRoutes>>(route: TRoute extends `POST ${infer TPath}` ? TPath : never, options?: { body?: unknown; query?: Record<string, string> }): Promise<TRoutes[TRoute]> {
		return this.apiClient.post(route as string, options);
	}

	/**
	 * Typed PATCH request - return type automatically inferred from TRoutes
	 */
	patch<TRoute extends ExtractPATCHRoutes<TRoutes>>(route: TRoute extends `PATCH ${infer TPath}` ? TPath : never, body?: unknown, options?: { query?: Record<string, string> }): Promise<TRoutes[TRoute]> {
		return this.apiClient.patch(route as string, { body, ...options });
	}

	/**
	 * Typed DELETE request - return type automatically inferred from TRoutes
	 */
	delete<TRoute extends ExtractDELETERoutes<TRoutes>>(route: TRoute extends `DELETE ${infer TPath}` ? TPath : never, options?: { query?: Record<string, string> }): Promise<TRoutes[TRoute]> {
		return this.apiClient.delete(route as string, options);
	}

	/**
	 * Special method for parameterized routes (e.g., /projects?id=123)
	 */
	getBy<TRoute extends ExtractGETRoutes<TRoutes>>(route: TRoute extends `GET ${infer TPath}` ? TPath : never, field: string, value: string): Promise<TRoutes[TRoute]> {
		return this.get(route, { query: { [field]: value } });
	}

	/**
	 * Helper method for building query parameters
	 */
	buildQuery(params: Record<string, string | undefined>): Record<string, string> {
		const query: Record<string, string> = {};
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null) {
				query[key] = value;
			}
		}
		return query;
	}

	/**
	 * Generic list method with optional filtering
	 */
	listWith<TRoute extends ExtractGETRoutes<TRoutes>>(route: TRoute extends `GET ${infer TPath}` ? TPath : never, filters: Record<string, string | undefined> = {}): Promise<TRoutes[TRoute]> {
		const query = this.buildQuery(filters);
		return this.get(route, Object.keys(query).length > 0 ? { query } : {});
	}
}
