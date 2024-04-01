import { db } from "../../database/db";
import { project } from "../../database/schema";
import { and, eq } from "drizzle-orm";

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
