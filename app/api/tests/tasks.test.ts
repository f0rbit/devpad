import { test, expect, describe } from 'bun:test';
import { test_client, is_integration_test } from './setup';

describe('Tasks API Client', () => {
  test('should list tasks', async () => {
    const tasks = await test_client.tasks.list();
    
    expect(Array.isArray(tasks)).toBe(true);
    if (tasks.length > 0) {
      const task = tasks[0];
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
    }
  });

  test('should create a task', async () => {
    const task_data = {
      title: 'Test Task ' + Date.now(),
      owner_id: 'test-owner', // Replace with actual owner ID
      visibility: 'PRIVATE',
      priority: 'MEDIUM'
    } as const;

    const created_task = await test_client.tasks.create(task_data);
    
    expect(created_task).toHaveProperty('id');
    expect(created_task.title).toBe(task_data.title);
  });

  test('should get a specific task', async () => {
    // First, list tasks to get an ID
    const tasks = await test_client.tasks.list();
    
    if (tasks.length > 0) {
      const task_id = tasks[0].id;
      const task = await test_client.tasks.get(task_id);
      
      expect(task).toHaveProperty('id', task_id);
      expect(task).toHaveProperty('title');
    }
  });

  test('should filter tasks by project', async () => {
    if (is_integration_test) {
      // Integration test: Create real project and task
      const project_data = {
        project_id: 'test-filter-project-' + Date.now(),
        name: 'Filter Test Project',
        owner_id: 'test-owner',
        visibility: 'PRIVATE',
        status: 'DEVELOPMENT'
      } as const;

      const created_project = await test_client.projects.create(project_data);
      
      const task_data = {
        title: 'Task with project ' + Date.now(),
        owner_id: 'test-owner',
        visibility: 'PRIVATE',
        priority: 'MEDIUM',
        project_id: created_project.id
      } as const;

      await test_client.tasks.create(task_data);
      
      const tasks = await test_client.tasks.list({ project_id: created_project.id });
      
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);
      tasks.forEach(task => {
        expect(task.project_id).toBe(created_project.id);
      });
    } else {
      // Unit test: Use mock project ID that will return mock tasks
      const project_id = 'mock-project-123';
      const tasks = await test_client.tasks.list({ project_id });
      
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThan(0);
      tasks.forEach(task => {
        expect(task.project_id).toBe(project_id);
      });
    }
  });
});