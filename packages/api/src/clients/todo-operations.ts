import { ApiClient } from '../utils/request';

export type TodoTag = {
	id?: string;
	title: string;
	color?: "red" | "green" | "blue" | "yellow" | "purple" | "orange" | "teal" | "pink" | "gray" | "cyan" | "lime" | null;
	deleted?: boolean;
	render?: boolean;
	owner_id: string;
};

export type UpsertTodoRequest = {
	id?: string | null;
	title?: string;
	summary?: string | null;
	description?: string | null;
	progress?: "UNSTARTED" | "IN_PROGRESS" | "COMPLETED";
	visibility?: "PUBLIC" | "PRIVATE" | "HIDDEN" | "ARCHIVED" | "DRAFT" | "DELETED";
	start_time?: string | null;
	end_time?: string | null;
	priority?: "LOW" | "MEDIUM" | "HIGH";
	owner_id: string;
	project_id?: string | null;
	tags?: TodoTag[];
};

export class TodoOperationsClient {
	private api_client: ApiClient;

	constructor(api_client: ApiClient) {
		this.api_client = api_client;
	}

	async upsert(request: UpsertTodoRequest): Promise<any> {
		return this.api_client.put<any>('/todo/upsert', {
			body: request
		});
	}

	async saveTags(tags: TodoTag[]): Promise<TodoTag[]> {
		return this.api_client.patch<TodoTag[]>('/todo/save_tags', {
			body: tags
		});
	}
}