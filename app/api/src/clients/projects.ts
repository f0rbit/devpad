import { ApiClient } from '../utils/request';
import type { ProjectType, ProjectUpsert } from '../types/common';

export class ProjectsClient {
  private api_client: ApiClient;

  constructor(api_client: ApiClient) {
    this.api_client = api_client;
  }

  async list() {
    // GET /projects returns all projects for the authenticated user
    return this.api_client.get<ProjectType[]>('/projects');
  }

  async get(id: string) {
    // GET /projects?id=<project_id>
    return this.api_client.get<ProjectType>('/projects', {
      query: { id }
    });
  }

  async getByName(name: string) {
    // GET /projects?name=<project_name>
    return this.api_client.get<ProjectType>('/projects', {
      query: { name }
    });
  }

  // Create or update a project using the PATCH endpoint
  async upsert(data: ProjectUpsert) {
    return this.api_client.patch<ProjectType>('/projects', {
      body: data
    });
  }

  // Convenience method for creating a new project
  async create(data: Omit<ProjectUpsert, 'id'>) {
    return this.upsert(data);
  }

  // Convenience method for updating an existing project  
  async update(project_id: string, data: Partial<Omit<ProjectUpsert, 'project_id'>>) {
    return this.upsert({ project_id, ...data });
  }

  // Note: Delete endpoint would need to be implemented on the backend
  async delete(id: string) {
    // For now, mark as archived using upsert
    return this.upsert({ project_id: id, archived: true });
  }
}