import type { Project, SaveConfigRequest, UpsertProject } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";
import { ProjectConfigClient } from "../resources/project-config";
import { ProjectSpecificationClient } from "../resources/project-specification";
import type { ApiClient } from "../utils/request";

/**
 * Clean, standardized Projects API client
 * Follows consistent CRUD patterns with nested resources
 */
export class ProjectsClient extends BaseClient {
	public readonly config: ProjectConfigClient;
	public readonly specification: ProjectSpecificationClient;

	constructor(apiClient: ApiClient) {
		super(apiClient);
		this.config = new ProjectConfigClient(apiClient);
		this.specification = new ProjectSpecificationClient(apiClient);
	}

	/**
	 * List projects with optional filtering
	 */
	async list(filters?: { private?: boolean }): Promise<Project[]> {
		if (filters?.private === true) {
			// Get all projects (includes private)
			return this.listWith<Project[]>("/projects");
		} else if (filters?.private === false) {
			// Get only public projects
			return this.listWith<Project[]>("/projects/public");
		} else {
			// Default: get all projects
			return this.listWith<Project[]>("/projects");
		}
	}

	/**
	 * Get project by ID
	 */
	async find(id: string): Promise<Project | null> {
		try {
			return await this.getBy<Project>("/projects", "id", id);
		} catch (error) {
			// If 404, return null instead of throwing
			return null;
		}
	}

	/**
	 * Create a new project
	 */
	async create(data: Omit<UpsertProject, "id">): Promise<Project> {
		return this.upsertEntity<Project, typeof data>("/projects", data);
	}

	/**
	 * Update an existing project
	 */
	async update(id: string, changes: Partial<Omit<UpsertProject, "id" | "project_id">>): Promise<Project>;
	async update(data: UpsertProject): Promise<Project>; // Backward compatibility signature
	async update(idOrData: string | UpsertProject, changes?: Partial<Omit<UpsertProject, "id" | "project_id">>): Promise<Project> {
		// Handle backward compatibility: update(data)
		if (typeof idOrData === "object" && idOrData.id) {
			return this.upsert(idOrData);
		}

		// Handle new clean interface: update(id, changes)
		const id = idOrData as string;
		if (!changes) {
			throw new Error("Changes parameter required for update");
		}

		// Fetch the existing project to get current values
		const existing = await this.find(id);
		if (!existing) {
			throw new Error(`Project with id ${id} not found`);
		}

		// Merge changes with existing project data
		const updateData: UpsertProject = {
			id: existing.id,
			project_id: existing.project_id,
			owner_id: existing.owner_id,
			name: existing.name,
			description: existing.description,
			specification: existing.specification,
			repo_url: existing.repo_url,
			repo_id: existing.repo_id,
			icon_url: existing.icon_url,
			status: existing.status,
			deleted: existing.deleted,
			link_url: existing.link_url,
			link_text: existing.link_text,
			visibility: existing.visibility,
			current_version: existing.current_version,
			...changes,
		};

		return this.upsertEntity<Project, UpsertProject>("/projects", updateData);
	}

	/**
	 * Delete a project (soft delete via visibility)
	 */
	async remove(id: string): Promise<void> {
		await this.update(id, { visibility: "DELETED" });
	}

	/**
	 * Archive a project
	 */
	async archive(id: string): Promise<Project> {
		return this.update(id, { visibility: "ARCHIVED" });
	}

	/**
	 * Publish a project (make it public)
	 */
	async publish(id: string): Promise<Project> {
		return this.update(id, { visibility: "PUBLIC" });
	}

	/**
	 * Make a project private
	 */
	async make_private(id: string): Promise<Project> {
		return this.update(id, { visibility: "PRIVATE" });
	}

	// === BACKWARD COMPATIBILITY METHODS ===

	async getById(id: string) {
		const project = await this.find(id);
		if (!project) throw new Error(`Project with id ${id} not found`);
		return project;
	}

	async getByName(name: string) {
		return this.getBy<Project>("/projects", "name", name);
	}

	async upsert(data: UpsertProject) {
		return this.upsertEntity<Project, UpsertProject>("/projects", data);
	}

	async upsertProject(data: UpsertProject): Promise<Project> {
		return this.upsert(data);
	}

	async deleteProject(data: Omit<UpsertProject, "archived">) {
		return this.deleteEntity<Project, typeof data>("/projects", data);
	}

	async saveConfig(request: SaveConfigRequest): Promise<void> {
		return this.config.save(request);
	}

	async fetchSpecification(projectId: string): Promise<string> {
		return this.specification.load(projectId);
	}
}
