import { BaseClient } from "../utils/base-client";
import { AuthKeysClient } from "../resources/auth-keys";
import type { ApiClient } from "../utils/request";
import type { Session } from "@devpad/schema";

/**
 * Clean, standardized Auth API client
 * Follows consistent patterns with nested resources
 */
export class AuthClient extends BaseClient {
	public readonly keys: AuthKeysClient;

	constructor(apiClient: ApiClient) {
		super(apiClient);
		this.keys = new AuthKeysClient(apiClient);
	}

	/**
	 * Login (redirect to OAuth)
	 */
	async login(): Promise<void> {
		return this.get<void>("/auth/login");
	}

	/**
	 * Logout
	 */
	async logout(): Promise<void> {
		return this.get<void>("/auth/logout");
	}

	/**
	 * Get current session information
	 */
	async session(): Promise<Session | null> {
		return this.get<Session | null>("/auth/session");
	}

	// === BACKWARD COMPATIBILITY METHODS ===

	async generateApiKey(): Promise<{ api_key: string }> {
		return this.keys.create();
	}

	async revokeApiKey(key_id: string): Promise<void> {
		return this.keys.revoke(key_id);
	}

	async getSession(): Promise<Session | null> {
		return this.get<Session | null>("/auth/session");
	}
}
