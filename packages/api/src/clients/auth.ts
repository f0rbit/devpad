import { BaseClient } from "../utils/base-client";

// TODO: add types to return of this
export class AuthClient extends BaseClient {
	async generateApiKey(): Promise<{ api_key: string }> {
		return this.post<{ api_key: string }>("/keys/create");
	}

	async revokeApiKey(key_id: string): Promise<void> {
		return this.post<void>(`/keys/${key_id}/delete`);
	}

	async login(): Promise<void> {
		return this.get<void>("/auth/login");
	}

	async logout(): Promise<void> {
		return this.get<void>("/auth/logout");
	}

	async getSession(): Promise<any> {
		return this.get<any>("/auth/session");
	}
}
