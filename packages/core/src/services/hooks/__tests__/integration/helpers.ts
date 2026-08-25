import { project } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Project } from "@devpad/schema";
import { eq } from "drizzle-orm";

export { create_test_db, seed_task, seed_user } from "../../../graph/__tests__/integration/helpers.js";

let project_counter = 0;
export async function seed_project(db: Database, owner_id: string, overrides: Partial<Project> = {}): Promise<Project> {
	const id = overrides.id ?? `project_test_${String(++project_counter)}`;
	await db.insert(project).values({
		id,
		owner_id,
		project_id: overrides.project_id ?? id,
		name: overrides.name ?? "Test project",
		status: overrides.status ?? "DEVELOPMENT",
		visibility: overrides.visibility ?? "PRIVATE",
	} as never);
	const rows = await db.select().from(project).where(eq(project.id, id));
	const row = rows[0];
	if (!row) throw new Error("seed_project: insert returned no row");
	return row;
}
