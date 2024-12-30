import { eq, inArray } from "drizzle-orm";
import { codebase_tasks, task, task_tag } from "../../database/schema";
import { db } from "../../database/db";


export async function getUserTasks(user_id: string) {
  // pull from tasks, there are a couple things we will need to fetch as well
  // task could have multiple tags & checklists

  // fetch tasks left joining codebase on codebase_task_id
  const fetched_tasks = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.owner_id, user_id));
  // append .tags = [] to each task
  const tasks = fetched_tasks.map((t) => {
    const new_task: _FetchTaskUnion = (t as any);
    new_task.tags = [];
    return new_task;
  });


  // get all tags for each task
  const task_ids = tasks.map((t) => t.task.id);

  if (task_ids.length > 0) {
    const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));
    // construct a Map of task_id -> array of tag_ids
    const mapped_tags = new Map<string, string[]>();
    tags.forEach((tag) => {
      const task_id = tag.task_id;
      if (!mapped_tags.has(task_id)) {
        mapped_tags.set(task_id, []);
      }
      mapped_tags.get(task_id)!.push(tag.tag_id);
    });

    for (const t of tasks) {
      t.tags = mapped_tags.get(t.task.id) ?? [];
    }
  }

  return tasks;
}

type _FetchedTask = typeof task.$inferSelect;
type _FetchedCodebaseTask = typeof codebase_tasks.$inferSelect;
type _FetchTaskUnion = { task: _FetchedTask, codebase_tasks: _FetchedCodebaseTask, tags: string[] };

export type Task = Awaited<ReturnType<typeof getUserTasks>>[0];

export async function getProjectTasks(project_id: string) {
  const tasks = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.project_id, project_id));

  // get all tags for each task
  const task_ids = tasks.map((t: any) => t.id);
  if (task_ids.length) {
    const tags = await db.select().from(task_tag).where(inArray(task_tag.task_id, task_ids));
    tasks.forEach((t: any) => {
      t.tags = tags.filter((tag: TagLink) => tag.task_id === t.id);
    });
  }

  return tasks;
}

export type TagLink = { task_id: string, tag_id: string, updated_at: string, created_at: string };

export async function getTask(todo_id: string) {
  const todo = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.id, todo_id));
  if (!todo || todo.length != 1) {
    return null;
  }
  const found = todo[0] as Task & { tags: TagLink[] };

  const tags = await db.select().from(task_tag).where(eq(task_tag.task_id, found.task.id));
  found.tags = tags ?? [];

  return found;
}
