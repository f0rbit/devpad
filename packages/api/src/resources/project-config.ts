import type { SaveConfigRequest, ProjectConfig } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

/**
 * Project configuration management client
 * Handles project-specific configuration operations
 */
export class ProjectConfigClient extends BaseClient {
	/**
	 * Get project configuration
	 */
	async load(project_id: string): Promise<ProjectConfig | null> {
		// TODO: Implement when backend endpoint exists - need to create GET /projects/{id}/config
		return this.getBy<ProjectConfig | null>("/projects/config", "project_id", project_id);
	}

	/**
	 * Save project configuration
	 */
	async save(request: SaveConfigRequest): Promise<void> {
		return this.patch<void>("/projects/save_config", {
			body: request,
		});
	}
}
