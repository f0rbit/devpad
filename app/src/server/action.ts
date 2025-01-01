import { db } from "../../database/db";
import { action, todo_updates, type ActionType } from "../../database/schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import type { HistoryAction } from "./types";


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

export async function getProjectHistory(project_id: string) {
  const project_filter: ActionType[] = ["CREATE_PROJECT", "UPDATE_PROJECT", "DELETE_PROJECT", "CREATE_TASK", "UPDATE_TASK", "DELETE_TASK"];

  // for actions, look through the 'data' json field, if action.project_id == project_id
  const actions = await getActions(project_id, project_filter);

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

  return filtered.concat(mapped_scan);
}
