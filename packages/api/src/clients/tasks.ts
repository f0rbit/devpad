import type { TaskWithDetails, UpsertTag, UpsertTodo } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

export class TasksClient extends BaseClient {

	async list(options: { project_id?: string; tag_id?: string } = {}) {
		const query = this.buildQuery({
			project: options.project_id,
			tag: options.tag_id,
		});

		return this.get<TaskWithDetails[]>("/tasks", Object.keys(query).length > 0 ? { query } : {});
	}

	async getById(id: string) {
		return this.get<TaskWithDetails>("/tasks", {
			query: { id },
		});
	}

	async getByProject(project_id: string) {
		return this.get<TaskWithDetails[]>("/tasks", {
			query: { project: project_id },
		});
	}

	async getByTag(tag_id: string) {
		return this.get<TaskWithDetails[]>("/tasks", {
			query: { tag: tag_id },
		});
	}

	async upsert(data: UpsertTodo & { tags?: UpsertTag[] }) {
		return this.patch<TaskWithDetails>("/tasks", {
			body: data,
		});
	}

	async create(data: Omit<UpsertTodo, "task_id"> & { tags?: UpsertTag[] }) {
		return this.upsert(data);
	}

	async update(task_id: string, data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }) {
		return this.upsert({ ...data, id: task_id });
	}

	async deleteTask(task: TaskWithDetails) {
		return this.upsert({ ...task.task, visibility: "DELETED" });
	}

	async saveTags(tags: UpsertTag[]): Promise<UpsertTag[]> {
		return this.patch<UpsertTag[]>("/tasks/save_tags", {
			body: tags,
		});
	}
}
