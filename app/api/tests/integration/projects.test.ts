import { test, expect, describe } from 'bun:test';
import { test_client } from './setup';

describe('projects API client integration', () => {
  test('should list projects', async () => {
    const projects = await test_client.projects.list();
    
    expect(Array.isArray(projects)).toBe(true);
    // Projects might be empty for a new user, which is fine
    if (projects.length > 0) {
      const project = projects[0];
      expect(project).toHaveProperty('id');
      expect(project).toHaveProperty('name');
    }
  });

  test('should get API status', async () => {
    // Test the basic API endpoint that should always work
    const response = await fetch('http://localhost:4321/api/v0');
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.version).toBe("0");
  });
});