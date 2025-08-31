import { ApiClient } from '../utils/request';

export type ProjectConfig = {
	tags: Array<{
		name: string;
		match: string[];
	}>;
	ignore: string[];
};

export type SaveConfigRequest = {
	id: string;
	config: ProjectConfig;
	scan_branch?: string;
};

export type UpsertProjectRequest = {
	id?: string;
	project_id: string;
	owner_id?: string;
	name: string;
	description: string | null;
	specification: string | null;
	repo_url: string | null;
	repo_id: number | null;
	icon_url: string | null;
	status?: "DEVELOPMENT" | "PAUSED" | "RELEASED" | "LIVE" | "FINISHED" | "ABANDONED" | "STOPPED";
	deleted?: boolean;
	link_url: string | null;
	link_text: string | null;
	visibility?: "PUBLIC" | "PRIVATE" | "HIDDEN" | "ARCHIVED" | "DRAFT" | "DELETED";
	current_version: string | null;
};

export class ProjectOperationsClient {
	private api_client: ApiClient;

	constructor(api_client: ApiClient) {
		this.api_client = api_client;
	}

	async saveConfig(request: SaveConfigRequest): Promise<void> {
		return this.api_client.patch<void>('/project/save_config', {
			body: request
		});
	}

	async fetchSpecification(projectId: string): Promise<string> {
		return this.api_client.get<string>('/project/fetch_spec', {
			query: { project_id: projectId }
		});
	}

	async upsert(request: UpsertProjectRequest): Promise<any> {
		return this.api_client.patch<any>('/project/upsert', {
			body: request
		});
	}
}