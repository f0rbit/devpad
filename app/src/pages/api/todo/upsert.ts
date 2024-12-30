import type { APIContext } from "astro";
import { task } from "../../../../database/schema";
import { db } from "../../../../database/db";
import { upsert_tag, upsert_todo, type UpsertTodo } from "../../../server/types";
import { z } from "zod";
import { upsertTag } from "../../../server/tags";

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

  if (body.tags) {
    // parse upsert tags
    const tag_parse = upsert_tags.safeParse(body.tags);
    if (!tag_parse.success) {
      console.warn(tag_parse.error);
      return new Response(tag_parse.error.message, { status: 400 });
    }
    const { data: tags } = tag_parse;
    // update any of the tags
    const promises = tags.map(upsertTag);
    await Promise.all(promises);
  }

  try {
    const insert = data as CompleteUpsertTodo;
    insert.updated_at = new Date().toISOString();

    const new_todo = await db.insert(task).values(insert).onConflictDoUpdate({ target: [task.id], set: insert }).returning();

    if (new_todo.length != 1) throw new Error(`Todo upsert returned incorrect rows (${new_todo.length}`);

    // TODO: then make sure there is a link between task and the tags

    return new Response(JSON.stringify(new_todo[0]), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 500 });
  }
}
