import type { TaskWithDetails, UpsertTag, UpsertTodo } from "@devpad/schema";
import { BaseClient } from "../utils/base-client";

export class TasksClient extends BaseClient {
	async list(options: { project_id?: string; tag_id?: string } = {}) {
		return this.listWith<TaskWithDetails[]>("/tasks", {
			project: options.project_id,
			tag: options.tag_id,
		});
	}

	async getById(id: string) {
		return this.getBy<TaskWithDetails>("/tasks", "id", id);
	}

	async getByProject(project_id: string) {
		return this.getBy<TaskWithDetails[]>("/tasks", "project", project_id);
	}

	async getByTag(tag_id: string) {
		return this.getBy<TaskWithDetails[]>("/tasks", "tag", tag_id);
	}

	async upsert(data: UpsertTodo & { tags?: UpsertTag[] }) {
		return this.upsertEntity<TaskWithDetails, typeof data>("/tasks", data);
	}

	async create(data: Omit<UpsertTodo, "task_id"> & { tags?: UpsertTag[] }) {
		return this.upsert(data);
	}

	async update(task_id: string, data: Omit<UpsertTodo, "id"> & { tags?: UpsertTag[] }) {
		return this.upsert({ ...data, id: task_id });
	}

	async deleteTask(task: TaskWithDetails) {
		return this.upsertEntity<TaskWithDetails, any>("/tasks", {
			...task.task,
			visibility: "DELETED",
		});
	}

	async saveTags(tags: UpsertTag[]): Promise<UpsertTag[]> {
		return this.patch<UpsertTag[]>("/tasks/save_tags", {
			body: tags,
		});
	}
}
