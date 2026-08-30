/**
 * @module tests/e2e/fixtures/canvas
 *
 * Typed seed fixture for the P2.5 canvas-home E2E suite. Reuses the SAME
 * deterministic ~500-node generator the spatial-index unit test relies on
 * (`build_synthetic_graph` — single source of truth for the stress shape),
 * remapping its `project_id`/`owner_id` onto the seeded E2E user/project and
 * filling in the audit columns (`created_by`/`modified_by`/`protected`/
 * `deleted`) the DB row needs but the domain `Task`/`TaskLink` types don't
 * carry. Mirrors `density.ts`'s structure — same `open_test_db` helper, same
 * delete-then-insert idempotency via a fixed id prefix.
 */

import { build_synthetic_graph } from "../../../apps/main/src/components/solid/canvas/__fixtures__/synthetic-graph";
import { project, task, task_link } from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq, like } from "drizzle-orm";
import { E2E_CANVAS_PROJECT_ID, E2E_CANVAS_TASK_COUNT, E2E_USER_ID } from "./canvas-ids";

export { E2E_CANVAS_PROJECT_ID, E2E_CANVAS_TASK_COUNT } from "./canvas-ids";

const SEED_NOW = new Date().toISOString();
const SYNTHETIC_ID_PREFIX = "synthetic-";
const SYNTHETIC_LINK_PREFIX = "synthetic-";

export async function seed_canvas_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_canvas_fixtures(db);

	await db.insert(project).values({
		id: E2E_CANVAS_PROJECT_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-canvas-project",
		project_id: E2E_CANVAS_PROJECT_ID,
		visibility: "PRIVATE",
		status: "DEVELOPMENT",
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	const graph = build_synthetic_graph(E2E_CANVAS_TASK_COUNT);

	const audit = {
		owner_id: E2E_USER_ID,
		project_id: E2E_CANVAS_PROJECT_ID,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user" as const,
		modified_by: "user" as const,
		protected: false,
		deleted: false,
	};

	// bun:sqlite chokes on a single 500-row INSERT — batch in chunks (same
	// concern the outline/density fixtures don't hit at their smaller scale).
	const BATCH = 100;
	for (let i = 0; i < graph.tasks.length; i += BATCH) {
		const chunk = graph.tasks.slice(i, i + BATCH).map((t) => ({
			...t,
			...audit,
			id: t.id,
			parent_id: t.parent_id,
		}));
		await db.insert(task).values(chunk as never[]);
	}

	for (let i = 0; i < graph.links.length; i += BATCH) {
		const chunk = graph.links.slice(i, i + BATCH).map((link) => ({
			...link,
			created_at: SEED_NOW,
			updated_at: SEED_NOW,
			created_by: "user" as const,
			modified_by: "user" as const,
			protected: false,
			deleted: false,
		}));
		await db.insert(task_link).values(chunk as never[]);
	}
}

async function delete_canvas_fixtures(db: DrizzleDatabase): Promise<void> {
	await db.delete(task_link).where(like(task_link.id, `${SYNTHETIC_LINK_PREFIX}%`));
	await db.delete(task).where(like(task.id, `${SYNTHETIC_ID_PREFIX}%`));
	await db.delete(project).where(eq(project.id, E2E_CANVAS_PROJECT_ID));
}
