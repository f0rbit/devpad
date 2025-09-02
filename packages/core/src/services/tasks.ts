import type { UpdateData } from "@devpad/schema";
import { type ActionType } from "@devpad/schema/database";
import { taskRepository, type Task, type _FetchedTask } from "../data/task-repository";

export async function getUserTasks(user_id: string): Promise<Task[]> {
	return taskRepository.getUserTasks(user_id);
}

export type { Task, _FetchedTask };

export async function getProjectTasks(project_id: string): Promise<Task[]> {
	return taskRepository.getProjectTasks(project_id);
}

export type TagLink = { task_id: string; tag_id: string; updated_at: string; created_at: string };

export async function getTask(todo_id: string): Promise<Task | null> {
	return taskRepository.getTask(todo_id);
}

export async function addTaskAction({ owner_id, task_id, type, description, project_id }: { owner_id: string; task_id: string; type: ActionType; description: string; project_id: string | null }): Promise<boolean> {
	return taskRepository.addTaskAction({ owner_id, task_id, type, description, project_id });
}

export async function getUpsertedTaskMap(codebase_items: UpdateData[]): Promise<Map<string, string>> {
	return taskRepository.getUpsertedTaskMap(codebase_items);
}

export async function getTasksByTag(tag_id: string): Promise<Task[]> {
	return taskRepository.getTasksByTag(tag_id);
}

export async function upsertTask(data: any, tags: any[], owner_id: string): Promise<Task | null> {
	return taskRepository.upsertTask(data, tags, owner_id);
}
