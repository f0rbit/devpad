import type { Tag, UpsertTag } from "@devpad/schema";
import { tagRepository } from "../data/tag-repository";

export async function getUserTags(user_id: string): Promise<Tag[]> {
	return tagRepository.getUserTags(user_id);
}

export async function getActiveUserTags(user_id: string): Promise<Tag[]> {
	return tagRepository.getActiveUserTags(user_id);
}

export async function getTaskTags(task_id: string): Promise<Tag[]> {
	return tagRepository.getTaskTags(task_id);
}

export async function upsertTag(data: UpsertTag): Promise<string> {
	return tagRepository.upsertTag(data);
}

export async function getActiveUserTagsMap(user_id: string): Promise<Map<string, Tag>> {
	return tagRepository.getActiveUserTagsMap(user_id);
}

export async function getActiveUserTagsMapByName(user_id: string): Promise<Map<string, Tag>> {
	return tagRepository.getActiveUserTagsMapByName(user_id);
}

export async function linkTaskToTag(task_id: string, tag_id: string): Promise<boolean> {
	return tagRepository.linkTaskToTag(task_id, tag_id);
}
