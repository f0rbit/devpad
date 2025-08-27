import { ApiClient } from '../utils/request';
import type { InsertProject, SelectProject } from '../types/common';

export class ProjectsClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list() {
    // GET /projects returns all projects for the authenticated user
    return this.api_client.get<SelectProject[]>('/projects');
  }

  async get(id: string) {
    // GET /projects?id=<project_id>
    return this.api_client.get<SelectProject>('/projects', {
      query: { id }
    });
  }

  async getByName(name: string) {
    // GET /projects?name=<project_name>
    return this.api_client.get<SelectProject>('/projects', {
      query: { name }
    });
  }

  // Note: The current Astro API routes don't have POST endpoints for creating projects
  // These would need to be added to the Astro routes first
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