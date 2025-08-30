import { DevpadApiClient } from '../../src';

const integration_config = {
  base_url: process.env.DEVPAD_TEST_BASE_URL || 'http://localhost:4321/api/v0',
  api_key: process.env.DEVPAD_TEST_API_KEY || 'test-integration-key-12345678'
};

export const test_client = new DevpadApiClient(integration_config);
export const TEST_USER_ID = 'test-user-12345';