import { DevpadApiClient } from '../src';

// Check if running integration tests
const is_integration_test = process.env.DEVPAD_TEST_TYPE === 'integration';

let test_client: DevpadApiClient;

if (is_integration_test) {
  // Use real API configuration for integration tests
  const integration_config = {
    base_url: process.env.DEVPAD_TEST_BASE_URL || 'http://localhost:8080/api/v0',
    api_key: process.env.DEVPAD_TEST_API_KEY || ''
  };
  
  console.log('INTEGRATION: Using real API at', integration_config.base_url);
  test_client = new DevpadApiClient(integration_config);
} else {
  // Mock configuration for unit tests
  const mock_config = {
    base_url: 'https://mock.devpad.local',
    api_key: 'mock-test-key-123456'
  };

  // Global fetch mock for unit tests only
  global.fetch = async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.parse(options.body as string) : {};

    console.log(`MOCK: Received request to ${url} with method ${method}`);

    return {
      ok: true,
      status: method === 'POST' ? 201 : 200,
      headers: new Headers({
        'Content-Type': 'application/json'
      }),
      json: async () => {
        if (url.toString().includes('/projects')) {
          if (method === 'GET') {
            return url.toString().includes('/projects/')
              ? {
                  id: 'mock-project-123',
                  project_id: 'test-project',
                  name: 'Test Project',
                  owner_id: 'test-owner',
                  visibility: 'PRIVATE',
                  status: 'DEVELOPMENT'
                }
              : [{
                  id: 'mock-project-123',
                  project_id: 'test-project',
                  name: 'Test Project',
                  owner_id: 'test-owner',
                  visibility: 'PRIVATE',
                  status: 'DEVELOPMENT'
                }];
          }
          return {
            id: 'new-project-' + Date.now(),
            project_id: body.project_id || 'new-project',
            name: body.name || 'New Project',
            owner_id: body.owner_id || 'test-owner',
            visibility: body.visibility || 'PRIVATE',
            status: body.status || 'DEVELOPMENT'
          };
        }

        if (url.toString().includes('/tasks')) {
          if (method === 'GET') {
            return url.toString().includes('/tasks/')
              ? {
                  id: 'mock-task-123',
                  title: 'Test Task',
                  owner_id: 'test-owner',
                  visibility: 'PRIVATE',
                  priority: 'MEDIUM',
                  project_id: 'test-project'
                }
              : [{
                  id: 'mock-task-123',
                  title: 'Test Task',
                  owner_id: 'test-owner',
                  visibility: 'PRIVATE',
                  priority: 'MEDIUM',
                  project_id: 'test-project'
                }];
          }
          return {
            id: 'new-task-' + Date.now(),
            title: body.title || 'New Task',
            owner_id: body.owner_id || 'test-owner',
            visibility: body.visibility || 'PRIVATE',
            priority: body.priority || 'MEDIUM'
          };
        }

        return {
          id: 'mock-' + Date.now(),
          message: 'Mock response'
        };
      },
      text: async () => 'Mock response',
      blob: async () => new Blob(['Mock response']),
      arrayBuffer: async () => new ArrayBuffer(8)
    } as Response;
  };

  test_client = new DevpadApiClient(mock_config);
}

export { test_client, is_integration_test };