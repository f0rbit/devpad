import { ApiClient } from '../utils/request';
import type { InsertTask, SelectTask } from '../types/common';

export class TasksClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list(options: { 
    project_id?: string;
    tag?: string;
    visibility?: SelectTask['visibility']
  } = {}) {
    return this.api_client.get<SelectTask[]>('/tasks', {
      query: {
        ...(options.project_id && { project: options.project_id }),
        ...(options.tag && { tag: options.tag }),
        ...(options.visibility && { visibility: options.visibility })
      }
    });
  }

  async get(id: string) {
    return this.api_client.get<SelectTask>(`/tasks/${id}`);
  }

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