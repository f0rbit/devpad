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

  async generate_api_key(): Promise<{ api_key: string }> {
    return this.api_client.post<{ api_key: string }>('/auth/api-key');
  }

  async revoke_api_key(api_key: string): Promise<void> {
    return this.api_client.post<void>('/auth/revoke-api-key', {
      body: { api_key }
    });
  }
}