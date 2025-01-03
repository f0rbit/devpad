import { eq, inArray, isNull, and, or } from "drizzle-orm";
import { tag, task_tag } from "../../database/schema";
import { db } from "../../database/db";
import type { UpsertTag } from "./types";


export async function getUserTags(user_id: string) {
  const tags = await db.select().from(tag).where(eq(tag.owner_id, user_id));

  return tags;
}

export async function getActiveUserTags(user_id: string) {
  const tags = await db.select().from(tag).where(and(eq(tag.owner_id, user_id), or(isNull(tag.deleted), eq(tag.deleted, false))));

  return tags;
}

export type Tag = Awaited<ReturnType<typeof getUserTags>>[0];

export async function getTaskTags(task_id: string) {
  const task_tags = await db.select().from(task_tag).where(eq(task_tag.task_id, task_id));

  const tag_ids = new Set(task_tags.map((t: any) => t.tag_id));
  if (tag_ids.size == 0) return [];

  const tags = await db.select().from(tag).where(inArray(tag.id, Array.from(tag_ids)));

  return tags;
}

export async function upsertTag(data: UpsertTag) {
  const res = await db.insert(tag).values(data).onConflictDoUpdate({ target: [tag.owner_id, tag.title], set: data }).returning({ id: tag.id });
  return res[0].id;
}
