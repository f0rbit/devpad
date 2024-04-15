import { db } from "../../database/db";
import { project, todo_updates } from "../../database/schema";
import { and, desc, eq } from "drizzle-orm";

export async function getUserProjects(user_id: string) {
	return await db.select().from(project).where(eq(project.owner_id, user_id));
}

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

export async function getRecentUpdate(project: any) {
	const { user_id, project_id }: { user_id: string, project_id: string } = project;
	if (!user_id) return null;
	if (!project_id) return null;

	// get the most recent entry from todo_updates table
	const updates = await db.select().from(todo_updates).where(and(eq(todo_updates.project_id, project_id), eq(todo_updates.user_id, user_id))).orderBy(desc(todo_updates.created_at)).limit(1);

	if (!updates || !updates[0]) return null;

	const update = updates[0] as any;
	update.old_data = null;
	update.new_data = null;

	// we need to append old and new data if they exist
	if (update.old_id) {
		const old = await db.select().from(todo_updates).where(eq(todo_updates.id, update.old_id));
		if (old && old[0]) update.old_data = old[0];
	}
	if (update.new_id) {
		const new_ = await db.select().from(todo_updates).where(eq(todo_updates.id, update.new_id));
		if (new_ && new_[0]) update.new_data = new_[0];
	}

	return update;
}
