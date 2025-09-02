import type { Project, SaveConfigRequest, UpsertProject } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

export class ProjectsClient extends BaseClient {
	async list() {
		return this.listWith<Project[]>("/projects");
	}

	async getById(id: string) {
		return this.getBy<Project>("/projects", "id", id);
	}

	async getByName(name: string) {
		return this.getBy<Project>("/projects", "name", name);
	}

	async upsert(data: UpsertProject) {
		return this.upsertEntity<Project, UpsertProject>("/projects", data);
	}

	async create(data: Omit<UpsertProject, "id">) {
		return this.upsert(data);
	}

	async update(data: UpsertProject) {
		return this.upsert(data);
	}

	async upsertProject(data: UpsertProject): Promise<Project> {
		return this.upsert(data);
	}

	async deleteProject(data: Omit<UpsertProject, "archived">) {
		return this.deleteEntity<Project, typeof data>("/projects", data);
	}

	async saveConfig(request: SaveConfigRequest): Promise<void> {
		return this.patch<void>("/projects/save_config", {
			body: request,
		});
	}

	async fetchSpecification(projectId: string): Promise<string> {
		return this.get<string>("/projects/fetch_spec", {
			query: { project_id: projectId },
		});
	}
}
