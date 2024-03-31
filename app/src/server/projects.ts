import { db } from "../../database/db";
import { project } from "../../database/schema";
import { eq } from "drizzle-orm";

export async function getUserProjects(user_id: string) {
	return await db.select().from(project).where(eq(project.owner_id, user_id));
}
