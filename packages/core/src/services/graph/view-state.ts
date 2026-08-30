import type { ProjectViewLayout } from "@devpad/schema";
import { project_view_state } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { errors, type ServiceError } from "../errors.js";
import { getProjectById } from "../projects.js";

/**
 * v2.5 (canvas home, task P3.1) — per-project canvas view state (pinned node
 * positions). This is a PROJECTION over the real graph (D1 stays the truth
 * for task/link data) — last-write-wins, no history, no merge. A default
 * empty layout is returned for a project that's never had a PUT, so callers
 * never have to special-case "no row yet" as an error.
 */
export const DEFAULT_VIEW_LAYOUT: ProjectViewLayout = { pins: {} };

export async function get_project_view_state(
	db: Database,
	input: { project_id: string; owner_id: string },
): Promise<Result<ProjectViewLayout, ServiceError>> {
	const project_result = await getProjectById(db, input.project_id);
	if (!project_result.ok) return project_result;
	if (project_result.value.owner_id !== input.owner_id) return errors.notFound("project", input.project_id);

	const row = await db
		.select()
		.from(project_view_state)
		.where(eq(project_view_state.project_id, input.project_id))
		.get();

	return ok(row?.layout ?? DEFAULT_VIEW_LAYOUT);
}

export async function put_project_view_state(
	db: Database,
	input: { project_id: string; owner_id: string; layout: ProjectViewLayout },
): Promise<Result<ProjectViewLayout, ServiceError>> {
	const project_result = await getProjectById(db, input.project_id);
	if (!project_result.ok) return project_result;
	if (project_result.value.owner_id !== input.owner_id) return errors.notFound("project", input.project_id);

	await db
		.insert(project_view_state)
		.values({ project_id: input.project_id, layout: input.layout })
		.onConflictDoUpdate({
			target: project_view_state.project_id,
			set: { layout: input.layout, updated_at: new Date().toISOString() },
		});

	return ok(input.layout);
}
