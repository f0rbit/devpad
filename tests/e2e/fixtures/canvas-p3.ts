/**
 * @module tests/e2e/fixtures/canvas-p3
 *
 * Typed seed fixture for the P3 canvas-home E2E suite. Same
 * delete-then-insert idempotency pattern as `canvas.ts`/`outline.ts`, but a
 * deliberately tiny 3-task graph (phase + user child + agent-created child)
 * so the ENTIRE graph is guaranteed visible at `camera.fit()`'s "map" level
 * — see `canvas-p3-ids.ts` for why this needs its own project.
 */

import { project, project_view_state, task } from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import {
	E2E_CANVAS_P3_AGENT_CHILD,
	E2E_CANVAS_P3_CHILD,
	E2E_CANVAS_P3_PHASE,
	E2E_CANVAS_P3_PROJECT_ID,
	E2E_USER_ID,
} from "./canvas-p3-ids";

export {
	E2E_CANVAS_P3_AGENT_CHILD,
	E2E_CANVAS_P3_CHILD,
	E2E_CANVAS_P3_PHASE,
	E2E_CANVAS_P3_PROJECT_ID,
} from "./canvas-p3-ids";

const SEED_NOW = new Date().toISOString();

export async function seed_canvas_p3_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_canvas_p3_fixtures(db);

	await db.insert(project).values({
		id: E2E_CANVAS_P3_PROJECT_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-canvas-p3-project",
		project_id: E2E_CANVAS_P3_PROJECT_ID,
		visibility: "PRIVATE",
		status: "DEVELOPMENT",
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	const base_task = {
		owner_id: E2E_USER_ID,
		project_id: E2E_CANVAS_P3_PROJECT_ID,
		visibility: "PRIVATE" as const,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		modified_by: "user" as const,
		protected: false,
		deleted: false,
		rev: 0,
	};

	await db.insert(task).values({
		...base_task,
		id: E2E_CANVAS_P3_PHASE,
		created_by: "user" as const,
		title: "Canvas P3 phase",
		kind: "phase",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		rank: "i0",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_CANVAS_P3_CHILD,
		created_by: "user" as const,
		title: "Canvas P3 child",
		kind: "task",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "HIGH",
		parent_id: E2E_CANVAS_P3_PHASE,
		rank: "i1",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_CANVAS_P3_AGENT_CHILD,
		created_by: "api" as const,
		title: "Canvas P3 agent child",
		kind: "task",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: E2E_CANVAS_P3_PHASE,
		rank: "i2",
	} as never);
}

async function delete_canvas_p3_fixtures(db: DrizzleDatabase): Promise<void> {
	await db.delete(project_view_state).where(eq(project_view_state.project_id, E2E_CANVAS_P3_PROJECT_ID));
	await db.delete(task).where(eq(task.id, E2E_CANVAS_P3_CHILD));
	await db.delete(task).where(eq(task.id, E2E_CANVAS_P3_AGENT_CHILD));
	await db.delete(task).where(eq(task.id, E2E_CANVAS_P3_PHASE));
	await db.delete(project).where(eq(project.id, E2E_CANVAS_P3_PROJECT_ID));
}
