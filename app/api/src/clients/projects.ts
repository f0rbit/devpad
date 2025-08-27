import { ApiClient } from '../utils/request';
import type { InsertProject, SelectProject } from '../types/common';

export class ProjectsClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list(options: { 
    visibility?: SelectProject['visibility'] 
  } = {}) {
    return this.api_client.get<SelectProject[]>('/projects', {
      query: options.visibility 
        ? { visibility: options.visibility } 
        : undefined
    });
  }

  async get(id: string) {
    return this.api_client.get<SelectProject>(`/projects/${id}`);
  }

  async create(data: InsertProject) {
    return this.api_client.post<SelectProject>('/projects', {
      body: data
    });
  }

  async update(id: string, data: Partial<InsertProject>) {
    return this.api_client.post<SelectProject>(`/projects/${id}`, {
      body: data
    });
  }

  async delete(id: string) {
    return this.api_client.post<void>(`/projects/${id}/delete`);
  }
}