/**
 * @module tests/e2e/fixtures/canvas-staging
 *
 * Seeds the EXACT graph shape Tom reviewed on staging (55 tasks, 47 with a
 * `parent_id`, 5 `task_link` rows) — `staging-devpad-graph.json` is a raw
 * `{tasks, links, rollups}` dump of that project. `rollups` is server-
 * computed (never a DB table, see `packages/schema/src/validation.ts`'s
 * `project_graph_rollup_counts`), so only `tasks`/`links` get seeded.
 *
 * Every id is re-prefixed with `STAGING_ID_PREFIX` (not just the project id)
 * so cleanup can `like`-match task/link rows the same way `canvas.ts`'s
 * synthetic fixture does, and every cross-reference (`parent_id`, `goal_id`,
 * `src_id`, `dst_id`) is remapped alongside it so the graph's real shape
 * (hierarchy + the 5 link edges) survives the rename intact.
 */

import { project, task, task_link } from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq, like } from "drizzle-orm";
import { E2E_USER_ID } from "./canvas-ids";
import staging_graph from "./staging-devpad-graph.json" with { type: "json" };

export { E2E_USER_ID } from "./canvas-ids";

export const E2E_CANVAS_STAGING_PROJECT_ID = "e2e-canvas-staging-project" as const;

const STAGING_ID_PREFIX = "staging-";
const remap_id = (id: string): string => `${STAGING_ID_PREFIX}${id}`;
const remap_ref = (id: string | null): string | null => (id === null ? null : remap_id(id));

type StagingTask = (typeof staging_graph.tasks)[number];
type StagingLink = (typeof staging_graph.links)[number];

export async function seed_canvas_staging_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_canvas_staging_fixtures(db);

	await db.insert(project).values({
		id: E2E_CANVAS_STAGING_PROJECT_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-canvas-staging-project",
		project_id: E2E_CANVAS_STAGING_PROJECT_ID,
		visibility: "PRIVATE",
		status: "DEVELOPMENT",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	const tasks = (staging_graph.tasks as StagingTask[]).map((raw_task) => ({
		...raw_task,
		id: remap_id(raw_task.id),
		owner_id: E2E_USER_ID,
		project_id: E2E_CANVAS_STAGING_PROJECT_ID,
		parent_id: remap_ref(raw_task.parent_id),
		goal_id: remap_ref(raw_task.goal_id),
	}));
	await db.insert(task).values(tasks as never[]);

	const links = (staging_graph.links as StagingLink[]).map((raw_link) => ({
		...raw_link,
		id: remap_id(raw_link.id),
		src_id: remap_id(raw_link.src_id),
		dst_id: remap_ref(raw_link.dst_id),
	}));
	await db.insert(task_link).values(links as never[]);
}

async function delete_canvas_staging_fixtures(db: DrizzleDatabase): Promise<void> {
	await db.delete(task_link).where(like(task_link.id, `${STAGING_ID_PREFIX}%`));
	await db.delete(task).where(like(task.id, `${STAGING_ID_PREFIX}%`));
	await db.delete(project).where(eq(project.id, E2E_CANVAS_STAGING_PROJECT_ID));
}
