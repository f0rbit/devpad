import { ApiClient } from '../utils/request';
import type { InsertTask, SelectTask } from '../types/common';

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
    
    return this.api_client.get<SelectTask[]>('/tasks', {
      query: Object.keys(query).length > 0 ? query : undefined
    });
  }

  async get(id: string) {
    // GET /tasks?id=<task_id>
    return this.api_client.get<SelectTask>('/tasks', {
      query: { id }
    });
  }

  async getByProject(project_id: string) {
    // GET /tasks?project=<project_id>
    return this.api_client.get<SelectTask[]>('/tasks', {
      query: { project: project_id }
    });
  }

  async getByTag(tag_id: string) {
    // GET /tasks?tag=<tag_id>
    return this.api_client.get<SelectTask[]>('/tasks', {
      query: { tag: tag_id }
    });
  }

  // Note: The current Astro API routes don't have POST endpoints for creating tasks
  // These would need to be added to the Astro routes first
  async create(data: InsertTask) {
    return this.api_client.post<SelectTask>('/tasks', {
      body: data
    });
  }

  async update(id: string, data: Partial<InsertTask>) {
    return this.api_client.post<SelectTask>(`/tasks/${id}`, {
      body: data
    });
  }

  async delete(id: string) {
    return this.api_client.post<void>(`/tasks/${id}/delete`);
  }
}