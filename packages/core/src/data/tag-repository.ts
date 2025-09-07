import type { Tag, UpsertTag } from "@devpad/schema";
import { db, tag, task_tag } from "@devpad/schema/database/server";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { BaseRepository } from "./base-repository";

export class TagRepository extends BaseRepository<typeof tag, Tag, UpsertTag> {
	constructor() {
		super(tag);
	}

	async getUserTags(user_id: string): Promise<Tag[]> {
		return this.findBy("owner_id", user_id);
	}

	async getActiveUserTags(user_id: string): Promise<Tag[]> {
		try {
			const result = await db
				.select()
				.from(tag)
				.where(and(eq(tag.owner_id, user_id), or(isNull(tag.deleted), eq(tag.deleted, false))));
			return result as Tag[];
		} catch (error) {
			return [];
		}
	}

	async getTaskTags(task_id: string): Promise<Tag[]> {
		try {
			const task_tags = await db.select().from(task_tag).where(eq(task_tag.task_id, task_id));

			const tag_ids = new Set(task_tags.map((t: any) => t.tag_id));
			if (tag_ids.size === 0) return [];

			const tags = await db
				.select()
				.from(tag)
				.where(inArray(tag.id, Array.from(tag_ids)));

			return tags as Tag[];
		} catch (error) {
			return [];
		}
	}

	async upsertTag(data: UpsertTag): Promise<string> {
		try {
			const res = await db
				.insert(tag)
				.values(data)
				.onConflictDoUpdate({ target: [tag.owner_id, tag.title], set: data })
				.returning({ id: tag.id });
			return res[0].id;
		} catch (error) {
			throw error;
		}
	}

	async getActiveUserTagsMap(user_id: string): Promise<Map<string, Tag>> {
		const tags = await this.getActiveUserTags(user_id);
		const map = new Map<string, Tag>();
		for (const tag of tags) {
			map.set(tag.id, tag);
		}
		return map;
	}

	async getActiveUserTagsMapByName(user_id: string): Promise<Map<string, Tag>> {
		const tags = await this.getActiveUserTags(user_id);
		const map = new Map<string, Tag>();
		for (const tag of tags) {
			map.set(tag.title, tag);
		}
		return map;
	}

	async linkTaskToTag(task_id: string, tag_id: string): Promise<boolean> {
		try {
			await db.insert(task_tag).values({ task_id, tag_id }).onConflictDoNothing();
			return true;
		} catch (error) {
			return false;
		}
	}
}

// Export singleton instance
export const tagRepository = new TagRepository();
