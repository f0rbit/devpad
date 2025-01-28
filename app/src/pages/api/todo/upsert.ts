import type { APIContext } from "astro";
import { task, task_tag } from "../../../../database/schema";
import { db } from "../../../../database/db";
import { upsert_tag, upsert_todo } from "../../../server/types";
import { z } from "zod";
import { getTaskTags, upsertTag } from "../../../server/tags";
import { and, eq, inArray, sql } from "drizzle-orm";
import { addTaskAction, getTask, type Task, type _FetchedTask } from "../../../server/tasks";

// type CompleteUpsertTodo = Omit<UpsertTodo, "todo_id"> & { id: string, updated_at: string };

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

  let tag_ids: string[] = [];

  if (body.tags) {
    // TODO: add actions for tags

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

  const previous = await (async () => {
    if (!data.id) return null;
    return (await getTask(data.id))?.task ?? null;
  })();
  
  const exists = !!previous;

  const project_id = data.project_id ?? previous?.project_id ?? null;

  try {
    const upsert = data as any;
    upsert.updated_at = new Date().toISOString();
    if (upsert.id == "" || upsert.id == null) delete upsert.id;


    let res: _FetchedTask[] | null = null;
    if (exists) {
      // perform update
      res = await db.update(task).set(upsert).where(eq(task.id, upsert.id)).returning();
    } else {
      // perform insert
      res = await db.insert(task).values(upsert).onConflictDoUpdate({ target: [task.id], set: upsert }).returning();
    }
    if (!res || res.length != 1) throw new Error(`Todo upsert returned incorrect rows (${res?.length ?? 0})`);

    const [new_todo] = res;
  
    const fresh_complete = data.progress == "COMPLETED" && previous?.progress != "COMPLETED";

    if (!exists) {
      // add CREATE_TASK action
      await addTaskAction({ owner_id: data.owner_id, task_id: new_todo.id, type: "CREATE_TASK", description: "Created task", project_id });
    } else if (fresh_complete) {
      // add COMPLETE_TASK action
      await addTaskAction({ owner_id: data.owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Completed task", project_id });
    } else {
      // add UPDATE_TASK action
      // TODO: for task updates, include the changes as a diff in the data
      await addTaskAction({ owner_id: data.owner_id, task_id: new_todo.id, type: "UPDATE_TASK", description: "Updated task", project_id });
    }

    // link each tag to every task
    if (tag_ids.length > 0) {
      try {
        await upsertTags(new_todo.id, tag_ids);
      } catch (err) {
        console.error("Error upserting tag links", err);
        return new Response(null, { status: 500 });
      }
    }

    return new Response(JSON.stringify(new_todo), { status: 200 });
  } catch (err) {
    console.error("Error upserting todo", err);
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
    await db.insert(task_tag).values(insert_tags);
  }

  // update the updated_at time on each link
  await db.update(task_tag).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task_tag.task_id, task_id));
}
