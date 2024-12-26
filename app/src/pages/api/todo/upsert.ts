import type { APIContext } from "astro";
import { task } from "../../../../database/schema";
import { db } from "../../../../database/db";
import { upsert_todo, type UpsertTodo } from "../../../server/types";

type CompleteUpsertTodo = Omit<UpsertTodo, "todo_id"> & { id: string, updated_at: string };

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

  try {
    const insert = data as CompleteUpsertTodo;
    insert.updated_at = new Date().toISOString();

    const new_todo = await db.insert(task).values(insert).onConflictDoUpdate({ target: [task.id], set: insert }).returning();

    if (new_todo.length != 1) throw new Error(`Todo upsert returned incorrect rows (${new_todo.length}`);

    return new Response(JSON.stringify(new_todo[0]), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(null, { status: 500 });
  }
}
