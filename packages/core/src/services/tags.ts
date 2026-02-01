import type { Tag, UpsertTag } from "@devpad/schema";
import { tag, task_tag } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import { and, eq } from "drizzle-orm";
import type { ServiceError } from "./errors.js";

export async function getUserTags(db: Database, user_id: string): Promise<Result<Tag[], ServiceError>> {
	const result = await db.select().from(tag).where(eq(tag.owner_id, user_id));
	return ok(result);
}

export async function getActiveUserTags(db: Database, user_id: string): Promise<Result<Tag[], ServiceError>> {
	const result = await db
		.select()
		.from(tag)
		.where(and(eq(tag.owner_id, user_id), eq(tag.deleted, false)));
	return ok(result);
}

export async function getTaskTags(db: Database, task_id: string): Promise<Result<Tag[], ServiceError>> {
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
	return ok(result);
}

export async function upsertTag(db: Database, data: UpsertTag): Promise<Result<string, ServiceError>> {
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

	if (!result[0]?.id) return err({ kind: "db_error", message: "Tag upsert returned no result" });
	return ok(result[0].id);
}

export async function getActiveUserTagsMap(db: Database, user_id: string): Promise<Result<Map<string, Tag>, ServiceError>> {
	const tags_result = await getActiveUserTags(db, user_id);
	if (!tags_result.ok) return tags_result;

	const map = new Map<string, Tag>();
	for (const t of tags_result.value) {
		map.set(t.id, t);
	}
	return ok(map);
}

export async function getActiveUserTagsMapByName(db: Database, user_id: string): Promise<Result<Map<string, Tag>, ServiceError>> {
	const tags_result = await getActiveUserTags(db, user_id);
	if (!tags_result.ok) return tags_result;

	const map = new Map<string, Tag>();
	for (const t of tags_result.value) {
		map.set(t.title, t);
	}
	return ok(map);
}

export async function linkTaskToTag(db: Database, task_id: string, tag_id: string): Promise<Result<boolean, ServiceError>> {
	await db.insert(task_tag).values({ task_id, tag_id });
	return ok(true);
}
