import type { Tag, UpsertTag } from "@devpad/schema";
import { db, tag, task_tag } from "@devpad/schema/database/server";
import { and, eq } from "drizzle-orm";

export async function getUserTags(user_id: string): Promise<Tag[]> {
	const result = await db.select().from(tag).where(eq(tag.owner_id, user_id));
	return result;
}

export async function getActiveUserTags(user_id: string): Promise<Tag[]> {
	const result = await db
		.select()
		.from(tag)
		.where(and(eq(tag.owner_id, user_id), eq(tag.deleted, false)));
	return result;
}

export async function getTaskTags(task_id: string): Promise<Tag[]> {
	const result = await db
		.select({
			id: tag.id,
			title: tag.title,
			color: tag.color,
			render: tag.render,
			owner_id: tag.owner_id,
			created_at: tag.created_at,
			updated_at: tag.updated_at,
			deleted: tag.deleted,
		})
		.from(task_tag)
		.innerJoin(tag, eq(task_tag.tag_id, tag.id))
		.where(eq(task_tag.task_id, task_id));
	return result;
}

export async function upsertTag(data: UpsertTag): Promise<string> {
	const upsert = {
		...data,
		updated_at: new Date().toISOString(),
	};
	if (upsert.id === "" || upsert.id == null) delete upsert.id;

	const result = await db
		.insert(tag)
		.values(upsert as any)
		.onConflictDoUpdate({ target: [tag.owner_id, tag.title], set: upsert as any })
		.returning();

	return result[0]?.id || "";
}

export async function getActiveUserTagsMap(user_id: string): Promise<Map<string, Tag>> {
	const tags = await getActiveUserTags(user_id);
	const map = new Map<string, Tag>();
	for (const tagItem of tags) {
		map.set(tagItem.id, tagItem);
	}
	return map;
}

export async function getActiveUserTagsMapByName(user_id: string): Promise<Map<string, Tag>> {
	const tags = await getActiveUserTags(user_id);
	const map = new Map<string, Tag>();
	for (const tagItem of tags) {
		map.set(tagItem.title, tagItem);
	}
	return map;
}

export async function linkTaskToTag(task_id: string, tag_id: string): Promise<boolean> {
	try {
		await db.insert(task_tag).values({ task_id, tag_id });
		return true;
	} catch {
		return false;
	}
}
