import { ApiClient } from '../utils/request';

export class AuthClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async generateApiKey(): Promise<{ api_key: string }> {
    return this.api_client.post<{ api_key: string }>('/keys/create');
  }

  async revokeApiKey(key_id: string): Promise<void> {
    return this.api_client.post<void>(`/keys/${key_id}/delete`);
  }

  async login(): Promise<void> {
    return this.api_client.get<void>('/auth/login');
  }

  async logout(): Promise<void> {
    return this.api_client.get<void>('/auth/logout');
  }

  async getSession(): Promise<any> {
    return this.api_client.get<any>('/auth/session');
  }
}