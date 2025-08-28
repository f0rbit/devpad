import { ApiClient } from '../utils/request';
import type { SelectProject, UpsertProject } from '../types/common';
import type { Project } from '../types/projects';

export class ProjectsClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list() {
    // GET /projects returns all projects for the authenticated user
    return this.api_client.get<Project[]>('/projects');
  }

  async get(id: string) {
    // GET /projects?id=<project_id>
    return this.api_client.get<Project>('/projects', {
      query: { id }
    });
  }

  async getByName(name: string) {
    // GET /projects?name=<project_name>
    return this.api_client.get<Project>('/projects', {
      query: { name }
    });
  }

  // Create or update a project using the PATCH endpoint
  async upsert(data: UpsertProject) {
    return this.api_client.patch<Project>('/projects', {
      body: data
    });
  }

  // Convenience method for creating a new project
  async create(data: Omit<UpsertProject, 'id'>) {
    return this.upsert(data);
  }

  // Convenience method for updating an existing project  
  async update(id: string, data: Partial<Omit<UpsertProject, 'id'>>) {
    return this.upsert({ id, ...data });
  }

  // Note: Delete endpoint would need to be implemented on the backend
  async delete(id: string) {
    // For now, mark as deleted using upsert
    return this.upsert({ id, deleted: true });
  }
}