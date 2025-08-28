import type { Project } from '@/src/server/projects';
import type { UpsertProject } from '@/src/server/types';
import { ApiClient } from '../utils/request';

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
  async update(data: UpsertProject) {
    return this.upsert(data);
  }

  // Note: Delete endpoint would need to be implemented on the backend
  async delete(data: Omit<UpsertProject, 'archived'>) {
    // For now, mark as archived using upsert
    return this.upsert({ ...data, deleted: true });
  }
}