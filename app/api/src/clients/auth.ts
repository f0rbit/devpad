import { ApiClient } from '../utils/request';
import { z } from 'zod';

export const ApiKeySchema = z.object({
  api_key: z.string().min(10, "API key must be at least 10 characters long")
});

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