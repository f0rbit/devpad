import { eq, inArray, sql } from "drizzle-orm";
import { action, codebase_tasks, task, task_tag, type ActionType } from "../../database/schema";
import { db } from "../../database/db";
import { doesUserOwnProject } from "./projects";
import type { UpdateData } from "./types";


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

export type _FetchedTask = typeof task.$inferSelect;
type _FetchedCodebaseTask = typeof codebase_tasks.$inferSelect;
type _FetchTaskUnion = { task: _FetchedTask, codebase_tasks: _FetchedCodebaseTask, tags: string[] };

export type Task = Awaited<ReturnType<typeof getUserTasks>>[0];

export async function getProjectTasks(project_id: string) {
  const fetched_tasks = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.project_id, project_id));
  // append .tags = [] to each task
  const tasks = fetched_tasks.map((t) => {
    const new_task: _FetchTaskUnion = (t as any);
    new_task.tags = [];
    return new_task;
  });


  // get all tags for each task
  const task_ids = tasks.map((t: any) => t.id);
  if (task_ids.length) {
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

export type TagLink = { task_id: string, tag_id: string, updated_at: string, created_at: string };

export async function getTask(todo_id: string) {
  const todo = await db.select().from(task).leftJoin(codebase_tasks, eq(task.codebase_task_id, codebase_tasks.id)).where(eq(task.id, todo_id));
  if (!todo || todo.length != 1) {
    return null;
  }
  const found = todo[0] as _FetchTaskUnion;

  const tags = await db.select().from(task_tag).where(eq(task_tag.task_id, found.task.id));
  found.tags = tags?.map((t) => t.tag_id) ?? [];

  return found;
}


export async function addTaskAction({ owner_id, task_id, type, description, project_id }: { owner_id: string, task_id: string, type: ActionType, description: string, project_id: string | null }) {
  // if project_id is null, don't write anything to the data field
  const data = { task_id } as { task_id: string, project_id?: string };
  if (project_id) {
    const user_owns = await doesUserOwnProject(owner_id, project_id);
    if (!user_owns) return false;
    data.project_id = project_id;
  }

  // add the action
  await db.insert(action).values({ owner_id, type, description, data });

  console.log("inserted action", type);

  return true;
}

export async function getUpsertedTaskMap(codebase_items: UpdateData[], titles: Record<string, string>, project_id: string, user_id: string) {
  // for every item we want to make sure we have a task associated with it,
  // if not, then we can create one. when creating, we can use the titles map to get the title, otherwise use item.data.new.text 
  const result = new Map<string, string>(); // codebase_tasks.id -> task.id

  const existing_tasks = await db.select().from(task).where(inArray(task.codebase_task_id, codebase_items.map((item) => item.id)));

  for (const t of existing_tasks) {
    result.set(t.codebase_task_id!, t.id);
  }

  return result;
}
