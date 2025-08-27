import { z } from 'zod';
import { DevpadApiError, NetworkError, AuthenticationError } from './errors';
import { ApiKeySchema } from '../clients/auth';

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
};

export class ApiClient {
  private base_url: string;
  private api_key: string;

  constructor(options: { base_url: string; api_key: string }) {
    // Validate API key is provided and meets schema requirements
    const parsed_key = ApiKeySchema.parse({ api_key: options.api_key });
    
    this.base_url = options.base_url;
    this.api_key = parsed_key.api_key;
  }

  private buildUrl(path: string, query?: Record<string, string>): URL {
    const url = new URL(`${this.base_url}${path}`);
    
    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
      });
    }

    return url;
  }

  private async request<T>(
    path: string, 
    options: RequestOptions = {}
  ): Promise<T> {
    const { 
      method = 'GET', 
      headers = {}, 
      body, 
      query 
    } = options;

    const url = this.buildUrl(path, query);

    const request_headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.api_key}`,
      ...headers,
    };

    try {
      console.log(`API Request: ${method} ${url.toString()}`);
      
      const response = await fetch(url, {
        method,
        headers: request_headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      console.log(`API Response Status: ${response.status}`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthenticationError('Invalid or expired API key');
        }
        if (response.status === 404) {
          throw new DevpadApiError('Resource not found', { statusCode: 404 });
        }
        
        // Try to get error message from response
        const error_text = await response.text();
        throw new DevpadApiError(error_text || 'Request failed', { statusCode: response.status });
      }

      // If the response doesn't have a body (like for delete methods), return void
      if (response.status === 204) {
        return undefined as T;
      }

      return await response.json() as T;
    } catch (error) {
      console.error('API Request Error:', error);
      
      if (error instanceof DevpadApiError || error instanceof AuthenticationError) {
        throw error;
      }
      
      throw new NetworkError(
        error instanceof Error ? error.message : 'Unknown network error'
      );
    }
  }

  public get<T>(
    path: string, 
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request(path, { ...options, method: 'GET' });
  }

  public post<T>(
    path: string, 
    options: Omit<RequestOptions, 'method'> = {}
  ): Promise<T> {
    return this.request(path, { ...options, method: 'POST' });
  }

  // Similar methods for PUT, PATCH, DELETE
}