import type { UpsertProject } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

/**
 * Project specification management client
 * Handles project specification operations (README fetching, etc.)
 */
export class ProjectSpecificationClient extends BaseClient {
	/**
	 * Get project specification
	 */
	async load(project_id: string): Promise<string> {
		return this.get<string>("/projects/fetch_spec", {
			query: { project_id },
		});
	}

	/**
	 * Update project specification
	 */
	async update(project_id: string, specification: string): Promise<void> {
		// Use the existing upsert endpoint to update specification
		return this.patch<void>("/projects", {
			body: {
				id: project_id,
				specification,
			} as Partial<UpsertProject>,
		});
	}
}
