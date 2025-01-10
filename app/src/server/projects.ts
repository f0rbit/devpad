import { and, desc, eq } from "drizzle-orm";
import { db } from "../../database/db";
import { action, project, todo_updates, tracker_result, type ActionType } from "../../database/schema";
import type { TodoUpdate, TrackerResult } from "./types";

export async function getUserProjects(user_id: string) {
  return await db.select().from(project).where(eq(project.owner_id, user_id));
}

export type Project = Awaited<ReturnType<typeof getUserProjects>>[0];

export async function getProject(user_id: string | null, project_id: string | undefined | null) {
  if (!user_id) return { project: null, error: "No user ID" };
  if (!project_id) return { project: null, error: "No project ID" };

  try {
    const search = await db.select().from(project).where(and(eq(project.owner_id, user_id), eq(project.project_id, project_id)));
    if (!search || !search[0]) return { project: null, error: "Couldn't find project" };
    return { project: search[0], error: null };
  } catch (err) {
    console.error(err);
    return { project: null, error: "Internal Server Error" };
  }
}

export async function getProjectById(project_id: string) {
  if (!project_id) return { project: null, error: "No project ID" };
  try {
    const search = await db.select().from(project).where(eq(project.id, project_id));
    if (!search || !search[0]) return { project: null, error: "Couldn't find project" };
    return { project: search[0], error: null };
  } catch (err) {
    console.error(err);
    return { project: null, error: "Internal Server Error" };
  }
}

export async function getRecentUpdate(project: Project) {
  const DEBUG_THIS = true;
  const { owner_id: user_id, id } = project;
  if (!user_id) {
    if (DEBUG_THIS) console.error("No owner_id ID");
    return null;
  }
  if (!id) {
    if (DEBUG_THIS) console.error("No project ID");
    return null;
  }

  // get the most recent entry from todo_updates table
  const updates = await db.select().from(todo_updates).where(and(eq(todo_updates.project_id, id), eq(todo_updates.status, "PENDING"))).orderBy(desc(todo_updates.created_at)).limit(1);

  if (!updates || !updates[0]) {
    if (DEBUG_THIS) console.error("No updates found");
    return null;
  }

  const update = updates[0] as TodoUpdate & { old_data: TrackerResult | null, new_data: TrackerResult | null };
  update.old_data = null;
  update.new_data = null;

  // we need to append old and new data if they exist
  if (update.old_id) {
    const old = await db.select().from(tracker_result).where(eq(tracker_result.id, update.old_id));
    if (old && old[0]) update.old_data = old[0];
  }
  if (update.new_id) {
    const new_ = await db.select().from(tracker_result).where(eq(tracker_result.id, update.new_id));
    if (new_ && new_[0]) update.new_data = new_[0];
  }

  return update;
}

export async function doesUserOwnProject(user_id: string, project_id: string) {
  const { project, error } = await getProjectById(project_id);
  if (error) {
    console.error("Error finding project in doesUserOwnProject", error);
    return false;
  }
  if (!project) {
    // project not found
    return false;
  }

  return project.owner_id == user_id;
}

export async function addProjectAction({ owner_id, project_id, type, description }: { owner_id: string, project_id: string, type: ActionType, description: string }) {
  const data = { project_id };

  const user_owns = await doesUserOwnProject(owner_id, project_id);
  if (!user_owns) return false;

  // add the action
  await db.insert(action).values({ owner_id, type, description, data });

  console.log("inserted action", type);

  return true;
}

