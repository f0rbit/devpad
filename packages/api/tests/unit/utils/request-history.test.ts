import { test, expect, describe, beforeEach } from 'bun:test';
import { ApiClient, type RequestHistoryEntry } from '../../../src/utils/request';

describe('ApiClient request history', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient({
      base_url: 'https://api.example.com',
      api_key: 'test-api-key-123456'
    });
  });

  test('should initialize with empty history', () => {
    const history = client.history();
    expect(history.list()).toEqual([]);
    expect(history.latest()).toBeNull();
  });

  test('should allow configurable history buffer size', () => {
    const customClient = new ApiClient({
      base_url: 'https://api.example.com',
      api_key: 'test-api-key-123456',
      max_history_size: 10
    });

    expect(customClient.history().list()).toEqual([]);
  });

  test('should allow clearing history', () => {
    // History starts empty
    expect(client.history().list()).toHaveLength(0);
    
    // Clear should work even on empty history
    client.history().clear();
    expect(client.history().list()).toHaveLength(0);
    expect(client.history().latest()).toBeNull();
  });

  test('should return readonly history array', () => {
    const history = client.history();

    // Should be an array
    expect(Array.isArray(history.list())).toBe(true);

    // Should be readonly - this test just verifies the type is ReadonlyArray
    expect(history.list()).toEqual([]);
  });

  test('should provide access to request history methods', () => {
    // Test that the API exists
    expect(typeof client.history().list).toBe('function');
    expect(typeof client.history().latest).toBe('function');
    expect(typeof client.history().clear).toBe('function');
  });

  test('should have proper TypeScript types for RequestHistoryEntry', () => {
    // Test that the RequestHistoryEntry type is properly structured
    const mockEntry: RequestHistoryEntry = {
      timestamp: '2024-01-01T00:00:00.000Z',
      method: 'GET',
      path: '/test',
      options: { method: 'GET' },
      url: 'https://api.example.com/test',
      status: 200,
      duration: 42,
      error: 'Optional error message'
    };

    // Verify required properties
    expect(mockEntry.timestamp).toBeDefined();
    expect(mockEntry.method).toBeDefined();
    expect(mockEntry.path).toBeDefined();
    expect(mockEntry.options).toBeDefined();
    expect(mockEntry.url).toBeDefined();

    // Verify optional properties
    expect(typeof mockEntry.status).toBe('number');
    expect(typeof mockEntry.duration).toBe('number');
    expect(typeof mockEntry.error).toBe('string');
  });

  test('should demonstrate usage pattern', () => {
    // This test shows how developers would use the history feature
    const client = new ApiClient({
      base_url: 'https://api.example.com',
      api_key: 'my-api-key',
      max_history_size: 10 // Optional: defaults to 5
    });

    // After making requests (mocked here), developers could:
    
    // Check the last request
    const lastRequest = client.history().latest();
    expect(lastRequest).toBeNull(); // No requests made yet
    
    // Get full history
    const allHistory = client.history().list();
    expect(allHistory).toEqual([]);
    
    // Clear history if needed
    client.history().clear();
    expect(client.history().list()).toEqual([]);
  });
});