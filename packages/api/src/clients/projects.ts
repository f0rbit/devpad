import type { Project, SaveConfigRequest, UpsertProject } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

export class ProjectsClient extends BaseClient {

	async list() {
		return this.get<Project[]>("/projects");
	}

	async getById(id: string) {
		return this.get<Project>("/projects", {
			query: { id },
		});
	}

	async getByName(name: string) {
		return this.get<Project>("/projects", {
			query: { name },
		});
	}

	async upsert(data: UpsertProject) {
		return this.patch<Project>("/projects", {
			body: data,
		});
	}

	async create(data: Omit<UpsertProject, "id">) {
		return this.upsert(data);
	}

	async update(data: UpsertProject) {
		return this.upsert(data);
	}

	async deleteProject(data: Omit<UpsertProject, "archived">) {
		return this.upsert({ ...data, deleted: true });
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

	async upsertProject(data: UpsertProject): Promise<Project> {
		return this.patch<Project>("/projects", {
			body: data,
		});
	}
}
