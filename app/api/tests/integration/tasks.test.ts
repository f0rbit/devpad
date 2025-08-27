import { test, expect, describe } from 'bun:test';
import { test_client } from './setup';

describe('tasks API client integration', () => {
  test('should list tasks', async () => {
    const tasks = await test_client.tasks.list();
    
    expect(Array.isArray(tasks)).toBe(true);
    // Tasks might be empty for a new user, which is fine
    if (tasks.length > 0) {
      const task = tasks[0];
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
    }
  });
});