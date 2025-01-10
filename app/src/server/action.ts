import { db } from "../../database/db";
import { action, todo_updates, type ActionType } from "../../database/schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import type { HistoryAction } from "./types";
import { getProjectById } from "./projects";
import { getTask } from "./tasks";


export async function getActions(user_id: string, action_filter: ActionType[] | null) {
  if (action_filter && action_filter.length == 0) action_filter = null;

  if (action_filter) {
    return await db.select().from(action).where(and(eq(action.owner_id, user_id), inArray(action.type, action_filter)));
  } else {
    return await db.select().from(action).where(eq(action.owner_id, user_id));
  }
}

export async function getProjectScanHistory(project_id: string) {
  return await db
    .select()
    .from(todo_updates)
    .where(eq(todo_updates.project_id, project_id))
    .orderBy(desc(todo_updates.created_at))
}

function sortByDate(a: HistoryAction, b: HistoryAction) {
  const a_time = new Date(a.created_at);
  const b_time = new Date(b.created_at);
  return b_time.getTime() - a_time.getTime();
}

export async function getProjectHistory(project_id: string) {
  const project_filter: ActionType[] = ["CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT", "CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

  // get the user id from the project
  const { project, error } = await getProjectById(project_id);
  if (error || !project) return [];
  const user_id = project.owner_id;

  // for actions, look through the 'data' json field, if action.project_id == project_id
  const actions = await getActions(user_id, project_filter);

  const filtered: HistoryAction[] = actions.filter((a) => {
    const data = (a.data as any);
    return data.project_id == project_id;
  });

  const scan_history = await getProjectScanHistory(project_id);
  // we need to map scan_history to be the same type as ActionType
  const mapped_scan: HistoryAction[] = scan_history.map((s) => {
    return {
      id: `scan-${s.id}`,
      type: "SCAN",
      description: `Scanned branch \'${s.branch}\'`,
      created_at: s.created_at,
      data: { project_id, message: s.commit_msg, status: s.status },
    };
  });

  const combined = filtered.concat(mapped_scan);

  // sort by .created_at (string)
  return combined.sort(sortByDate);
}

export async function getTaskHistory(task_id: string) {
  const task_filter: ActionType[] = ["CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

  // get the user id from the project
  const task = await getTask(task_id);
  if (!task) return [];
  const user_id = task.task.owner_id;

  // for actions, look through the 'data' json field, if action.task_id == task_id
  const actions = await getActions(user_id, task_filter);

  const filtered: HistoryAction[] = actions.filter((a) => {
    const data = (a.data as any);
    return data.task_id == task_id;
  });

  return filtered.sort(sortByDate);
}
