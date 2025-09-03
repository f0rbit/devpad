import { BaseClient } from "../utils/base-client";

/**
 * Authentication keys management client
 * Handles API key operations
 */
export class AuthKeysClient extends BaseClient {
	/**
	 * Create a new API key
	 */
	async create(): Promise<{ api_key: string }> {
		return this.post<{ api_key: string }>("/keys/create");
	}

	/**
	 * Delete/revoke an API key
	 */
	async revoke(key_id: string): Promise<void> {
		return this.post<void>(`/keys/${key_id}/delete`);
	}

	/**
	 * Alias for revoke - more RESTful name
	 */
	async remove(key_id: string): Promise<void> {
		return this.revoke(key_id);
	}
}
