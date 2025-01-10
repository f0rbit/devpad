import type { APIContext } from "astro";
import { z } from "zod";
import { db } from "../../../../database/db";
import { codebase_tasks, project, task, todo_updates, tracker_result } from "../../../../database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { UpdateData } from "../../../server/types";

const request_schema = z.object({
  id: z.number(),
  approved: z.boolean()
});


// should have ?project_id=<project-id>

export async function POST(context: APIContext) {
  if (!context.locals.user) {
    return new Response(null, { status: 401 });
  }

  const { id: user_id } = context.locals.user;

  const project_id = context.url.searchParams.get("project_id");

  if (!project_id) {
    return new Response("no project id", { status: 400 });
  }

  const body = await context.request.json();

  const parsed = request_schema.safeParse(body);
  if (!parsed.success) {
    console.warn(parsed.error);
    return new Response(parsed.error.message, { status: 400 });
  }
  const { approved, id: update_id } = parsed.data;

  // check that the user owns the project
  const project_query = await db.select().from(project).where(and(eq(project.id, project_id), eq(project.owner_id, user_id)));

  if (project_query.length != 1) {
    return new Response("project not found", { status: 404 });
  }

  // check that there is an update with the given id
  const update_query = await db.select().from(todo_updates).where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.id, update_id)));

  if (update_query.length != 1) {
    return new Response("update not found", { status: 404 });
  }

  // take the new_id from the update_query and set it's status to approved
  const update_data = update_query[0];
  const new_id = update_data.new_id;

  await db.update(tracker_result).set({ accepted: approved }).where(eq(tracker_result.id, new_id));

  // then we want to execute the update
  await db.update(todo_updates).set({ status: approved ? "ACCEPTED" : "REJECTED" }).where(eq(todo_updates.id, update_id));

  // TODO: extract this to function that throws errors on failure
  if (approved) {
    // update all the tasks within the update and codebase_task table
    // TODO: add typesafety to this, either infer datatype from schema or use zod validator
    let codebase_items: UpdateData[];
    try {
      codebase_items = JSON.parse(update_query[0].data as string) as UpdateData[];
    } catch (e) {
      console.error(e);
      return new Response("error parsing update data", { status: 500 });
    }
    // we want to group into 'upserts', 'deletes'
    const upserts = codebase_items.filter((item) => item.type == "NEW" || item.type == "UPDATE" || item.type == "SAME" || item.type == "MOVE");
    const changed = upserts.filter((item) => item.type != "SAME");
    const deletes = codebase_items.filter((item) => item.type == "DELETE");

    // run the upserts
    const upsert_item = async (item: any) => {
      const id = item.id;
      const type = item.tag;
      const text = item.data.new?.text;
      const line = item.data.new?.line;
      const file = item.data.new?.file;
      const context = item.data.new?.context;

      const branch = update_query[0].branch;
      const commit_sha = update_query[0].commit_sha;
      const commit_msg = update_query[0].commit_msg;
      const commit_url = update_query[0].commit_url;

      const values = { id, type, text, line, file, recent_scan_id: new_id, context, branch, commit_sha, commit_msg, commit_url, updated_at: sql`CURRENT_TIMESTAMP` };

      await db.insert(codebase_tasks).values(values).onConflictDoUpdate({ target: [codebase_tasks.id], set: values });
    };

    try {
      await Promise.all(upserts.map(upsert_item));
    } catch (e) {
      console.error(e);
      return new Response("error upserting tasks", { status: 500 });
    }


    // run the deletes
    const delete_item = async (item: any) => {
      const id = item.id;

      await db.delete(codebase_tasks).where(eq(codebase_tasks.id, id));
      // TODO: consider deleting the task from the task table as well
    };

    try {
      await Promise.all(deletes.map(delete_item));
    } catch (e) {
      console.error(e);
      return new Response("error deleting tasks", { status: 500 });
    }

    try {
      // update any tasks that have codebase_task_id that were deleted to null
      if (deletes.length > 0) {
        await db.update(task).set({ codebase_task_id: null }).where(inArray(task.codebase_task_id, deletes.map((item) => item.id)));
      }

      // then we want to check if there are any codebase_tasks that don't have an associated task
      let found_tasks = [] as any[];
      if (upserts.length > 0) {
        found_tasks = await db.select().from(task).where(inArray(task.codebase_task_id, upserts.map((item) => item.id)));
      }
      const found_ids = found_tasks.map((task) => task.codebase_task_id);
      const missing_tasks = upserts.filter((item) => !found_ids.includes(item.id));

      // if there are any, we want to create a task for them
      if (missing_tasks.length > 0) {
        const values = missing_tasks.map((item) => ({ codebase_task_id: item.id, project_id, title: item.data.new.text, owner_id: user_id }));
        await db.insert(task).values(values);
      }

      // set the updated_at field of all changed tasks
      if (changed.length > 0) {
        await db.update(task).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(inArray(task.codebase_task_id, changed.map((item) => item.id)));
      }

    } catch (e) {
      console.error(e);
      return new Response("error updating tasks", { status: 500 });
    }

  }

  return new Response(null, { status: 200 });
}
