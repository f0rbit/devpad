
// api endpoint for getting tasks
// params
// optional ?id=<task_uuid>
// optional ?tag=<tag_uuid>
// optional ?project=<project_uuid>

import type { APIContext } from "astro";
import { getProjectTasks, getTask, getTasksByTag, getUserTasks } from "../../../server/tasks";
import { getAuthedUser } from "../../../server/keys";

export async function GET(context: APIContext) {
  const { user_id, error } = await getAuthedUser(context);
  if (error) {
    return new Response(error, { status: 401 });
  }
  if (!user_id) {
    return new Response(null, { status: 401 });
  }

  // extract the query params from the request
  const query = context.url.searchParams;

  // extract the task id from the query params
  const id = query.get("id");
  const tag = query.get("tag");
  const project = query.get("project");

  if (id) {
    // get the task by id
    const task = await getTask(id);
    if (!task) {
      return new Response(null, { status: 404 });
    }
    if (task.task.owner_id != user_id) {
      return new Response(null, { status: 401 });
      // return new Response(null, { status: 401 });
    }
    return new Response(JSON.stringify(task));
  }

  if (tag) {
    // get the tasks by tag
    const tasks = await getTasksByTag(tag);
    if (error) {
      return new Response(error, { status: 401 });
    }
    if (!tasks) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify(tasks));
  }

  if (project) {
    // get the tasks by project
    const tasks = await getProjectTasks(project);
    if (!tasks) {
      return new Response(null, { status: 404 });
    }
    return new Response(JSON.stringify(tasks));
  }

  // no query params provided
  // return all tasks
  const tasks = await getUserTasks(user_id);
  return new Response(JSON.stringify(tasks, null, 2));
}   
