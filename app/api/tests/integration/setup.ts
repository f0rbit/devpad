import { DevpadApiClient } from '../../src';

// Integration test setup - tests against real Astro server
const integration_config = {
  base_url: process.env.DEVPAD_TEST_BASE_URL || 'http://localhost:4321/api/v0',
  api_key: process.env.DEVPAD_TEST_API_KEY || 'test-integration-key-12345678'
};

console.log('INTEGRATION: Using real API at', integration_config.base_url);

export const test_client = new DevpadApiClient(integration_config);