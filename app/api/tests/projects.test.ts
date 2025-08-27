import { test, expect, describe } from 'bun:test';
import { test_client, is_integration_test } from './setup';

describe('Projects API Client', () => {
  test('should list projects', async () => {
    const projects = await test_client.projects.list();
    
    expect(Array.isArray(projects)).toBe(true);
    if (projects.length > 0) {
      const project = projects[0];
      expect(project).toHaveProperty('id');
      expect(project).toHaveProperty('name');
    }
  });

  test('should create a project', async () => {
    const project_data = {
      project_id: 'test-project-' + Date.now(),
      name: 'Test Project',
      owner_id: 'test-owner', // Replace with actual owner ID
      visibility: 'PRIVATE',
      status: 'DEVELOPMENT'
    } as const;

    const created_project = await test_client.projects.create(project_data);
    
    expect(created_project).toHaveProperty('id');
    expect(created_project.name).toBe(project_data.name);
    expect(created_project.project_id).toBe(project_data.project_id);
  });

  test('should get a specific project', async () => {
    // First, list projects to get an ID
    const projects = await test_client.projects.list();
    
    if (projects.length > 0) {
      const project_id = projects[0].id;
      const project = await test_client.projects.get(project_id);
      
      expect(project).toHaveProperty('id', project_id);
      expect(project).toHaveProperty('name');
    }
  });
});