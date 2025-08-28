import { ApiClient } from '../utils/request';
import type { TaskType, TaskUpsert } from '../types/common';

export class TasksClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list(options: { 
    project_id?: string;
    tag_id?: string;
  } = {}) {
    const query: Record<string, string> = {};
    
    if (options.project_id) {
      query.project = options.project_id;
    }
    if (options.tag_id) {
      query.tag = options.tag_id;
    }
    
    return this.api_client.get<TaskType[]>('/tasks', 
      Object.keys(query).length > 0 ? { query } : {}
    );
  }

  async get(id: string) {
    // GET /tasks?id=<task_id>
    return this.api_client.get<TaskType>('/tasks', {
      query: { id }
    });
  }

  async getByProject(project_id: string) {
    // GET /tasks?project=<project_id>
    return this.api_client.get<TaskType[]>('/tasks', {
      query: { project: project_id }
    });
  }

  async getByTag(tag_id: string) {
    // GET /tasks?tag=<tag_id>
    return this.api_client.get<TaskType[]>('/tasks', {
      query: { tag: tag_id }
    });
  }

  // Create or update a task using the PATCH endpoint, with optional tag support
  async upsert(data: TaskUpsert & { tags?: string[] }) {
    return this.api_client.patch<TaskType>('/tasks', {
      body: data
    });
  }

  // Convenience method for creating a new task
  async create(data: Omit<TaskUpsert, 'task_id'> & { tags?: string[] }) {
    return this.upsert(data);
  }

  // Convenience method for updating an existing task
  async update(task_id: string, data: Partial<Omit<TaskUpsert, 'task_id'>> & { tags?: string[] }) {
    return this.upsert({ ...data, task_id });
  }

  // Note: Delete endpoint would need to be implemented on the backend  
  async delete(task_id: string) {
    // For now, mark task status as cancelled
    return this.upsert({ task_id, status: 'cancelled' });
  }
}