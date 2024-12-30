import type { APIContext } from "astro";
import { task, task_tag } from "../../../../database/schema";
import { db } from "../../../../database/db";
import { upsert_tag, upsert_todo, type UpsertTodo } from "../../../server/types";
import { z } from "zod";
import { getTaskTags, upsertTag } from "../../../server/tags";
import { and, eq, inArray, sql } from "drizzle-orm";

type CompleteUpsertTodo = Omit<UpsertTodo, "todo_id"> & { id: string, updated_at: string };

const upsert_tags = z.array(upsert_tag);

export async function PUT(context: APIContext) {
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  const body = await context.request.json();

  const parsed = upsert_todo.safeParse(body);
  if (!parsed.success) {
    console.warn(parsed.error);
    return new Response(parsed.error.message, { status: 400 });
  }
  const { data } = parsed;

  if (data.owner_id != context.locals.user.id) {
    return new Response(null, { status: 401 });
  }

  let tag_ids = null;

  if (body.tags) {
    // parse upsert tags
    const tag_parse = upsert_tags.safeParse(body.tags);
    if (!tag_parse.success) {
      console.warn(tag_parse.error);
      return new Response(tag_parse.error.message, { status: 400 });
    }
    const tags = tag_parse.data;
    // update any of the tags
    const promises = tags.map(upsertTag);
    tag_ids = await Promise.all(promises);
  }

  try {
    const insert = data as CompleteUpsertTodo;
    insert.updated_at = new Date().toISOString();

    const new_todo = await db.insert(task).values(insert).onConflictDoUpdate({ target: [task.id], set: insert }).returning();

    if (new_todo.length != 1) throw new Error(`Todo upsert returned incorrect rows (${new_todo.length}`);

    // link each tag to every task
    if (tag_ids) {
      try {
        await upsertTags(new_todo[0].id, tag_ids);
      } catch (err) {
        console.error("Error upserting tag links", err);
        return new Response(null, { status: 500 });
      }
    }

    return new Response(JSON.stringify(new_todo[0]), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 500 });
  }
}


async function upsertTags(task_id: string, tags: string[]) {
  // get the current tags on the task
  const current = (await getTaskTags(task_id)).map((c) => c.id);

  // split into [new, existing]
  const create = tags.filter((tag_id) => !current.find((current_id) => current_id === tag_id));

  // delete any tags that are no longer in the list
  const delete_tags = current.filter((id) => !tags.includes(id));

  if (delete_tags.length > 0) {
    await db.delete(task_tag).where(and(eq(task_tag.task_id, task_id), inArray(task_tag.tag_id, delete_tags)));
  }

  // insert any new tags
  const insert_tags = create.map((t) => ({ task_id: task_id, tag_id: t }));
  if (insert_tags.length > 0) {

    await db.insert(task_tag).values(insert_tags).onConflictDoNothing().returning({ tag_id: task_tag.tag_id });
  }

  // update the updated_at time on each link
  await db.update(task_tag).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task_tag.task_id, task_id));
}
