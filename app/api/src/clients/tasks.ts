import { ApiClient } from '../utils/request';
import type { UpsertTask, UpsertTag } from '../types/common';
import type { TaskUnion } from '../types/tasks';

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
    
    return this.api_client.get<TaskUnion[]>('/tasks', {
      query: Object.keys(query).length > 0 ? query : undefined
    });
  }

  async get(id: string) {
    // GET /tasks?id=<task_id>
    return this.api_client.get<TaskUnion>('/tasks', {
      query: { id }
    });
  }

  async getByProject(project_id: string) {
    // GET /tasks?project=<project_id>
    return this.api_client.get<TaskUnion[]>('/tasks', {
      query: { project: project_id }
    });
  }

  async getByTag(tag_id: string) {
    // GET /tasks?tag=<tag_id>
    return this.api_client.get<TaskUnion[]>('/tasks', {
      query: { tag: tag_id }
    });
  }

  // Create or update a task using the PATCH endpoint, with optional tag support
  async upsert(data: UpsertTask & { tags?: UpsertTag[] }) {
    return this.api_client.patch<TaskUnion>('/tasks', {
      body: data
    });
  }

  // Convenience method for creating a new task
  async create(data: Omit<UpsertTask, 'id'> & { tags?: UpsertTag[] }) {
    return this.upsert(data);
  }

  // Convenience method for updating an existing task
  async update(id: string, data: Partial<Omit<UpsertTask, 'id'>> & { tags?: UpsertTag[] }) {
    return this.upsert({ ...data, id, owner_id: data.owner_id || '' });
  }

  // Note: Delete endpoint would need to be implemented on the backend  
  async delete(id: string) {
    // For now, mark as deleted by setting visibility to DELETED
    // Note: This is a workaround since tasks don't have a 'deleted' field
    return this.upsert({ id, owner_id: '', visibility: 'DELETED' } as UpsertTask & { tags?: UpsertTag[] });
  }
}