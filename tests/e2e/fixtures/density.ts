/**
 * @module tests/e2e/fixtures/density
 *
 * ~30-node graph-lens density fixture (B2 fast-follow evidence): a focus task
 * with a 3-hop `task_link` BFS neighborhood — 1 focus + 6 depth-1 + 18 depth-2
 * + 5 depth-3 = 30 nodes — cycling every `TASK_LINK_KINDS` edge kind so the
 * lens' edge-kind grammar (dash pattern + color + arrow marker) has more than
 * one example of each kind to render. `near(FOCUS, 2)` stops at depth-2;
 * `near(FOCUS, 3)` also reaches the depth-3 layer — the two screenshots this
 * fixture exists for.
 */

import { project, task, task_link, TASK_LINK_KINDS, type TaskLinkKind } from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq, inArray, like } from "drizzle-orm";
import {
	density_depth1_id,
	density_depth2_id,
	density_depth3_id,
	E2E_DENSITY_DEPTH1_COUNT,
	E2E_DENSITY_DEPTH2_COUNT,
	E2E_DENSITY_DEPTH3_COUNT,
	E2E_DENSITY_FOCUS,
	E2E_DENSITY_PROJECT_ID,
	E2E_USER_ID,
} from "./density-ids";

export {
	density_depth1_id,
	density_depth2_id,
	density_depth3_id,
	E2E_DENSITY_FOCUS,
	E2E_DENSITY_PROJECT_ID,
} from "./density-ids";

const SEED_NOW = new Date().toISOString();
const PROGRESS = ["UNSTARTED", "IN_PROGRESS", "COMPLETED"] as const;
const PRIORITY = ["LOW", "MEDIUM", "HIGH"] as const;

const kindAt = (i: number): TaskLinkKind => TASK_LINK_KINDS[i % TASK_LINK_KINDS.length] ?? "relates_to";

export async function seed_density_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_density_fixtures(db);

	await db.insert(project).values({
		id: E2E_DENSITY_PROJECT_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-density-project",
		project_id: E2E_DENSITY_PROJECT_ID,
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
		project_id: E2E_DENSITY_PROJECT_ID,
		visibility: "PRIVATE" as const,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user" as const,
		modified_by: "user" as const,
		protected: false,
		deleted: false,
		rev: 0,
		parent_id: null,
	};

	const base_link = {
		ref: null,
		note: null,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user" as const,
		modified_by: "user" as const,
		protected: false,
		deleted: false,
	};

	const depth1_ids = Array.from({ length: E2E_DENSITY_DEPTH1_COUNT }, (_, i) => density_depth1_id(i));
	const depth2_ids = Array.from({ length: E2E_DENSITY_DEPTH2_COUNT }, (_, i) => density_depth2_id(i));
	const depth3_ids = Array.from({ length: E2E_DENSITY_DEPTH3_COUNT }, (_, i) => density_depth3_id(i));

	await db.insert(task).values({
		...base_task,
		id: E2E_DENSITY_FOCUS,
		title: "Density focus task",
		kind: "task",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "HIGH",
		rank: "z-focus",
	} as never);

	await db.insert(task).values(
		depth1_ids.map((id, i) => ({
			...base_task,
			id,
			title: `Depth-1 neighbor ${String(i)}`,
			kind: "task",
			completion_policy: "manual",
			progress: PROGRESS[i % PROGRESS.length],
			priority: PRIORITY[i % PRIORITY.length],
			rank: `z-d1-${String(i)}`,
		})) as never[],
	);

	await db.insert(task).values(
		depth2_ids.map((id, i) => ({
			...base_task,
			id,
			title: `Depth-2 neighbor ${String(i)}`,
			kind: "task",
			completion_policy: "manual",
			progress: PROGRESS[i % PROGRESS.length],
			priority: PRIORITY[i % PRIORITY.length],
			rank: `z-d2-${String(i)}`,
		})) as never[],
	);

	await db.insert(task).values(
		depth3_ids.map((id, i) => ({
			...base_task,
			id,
			title: `Depth-3 neighbor ${String(i)}`,
			kind: "task",
			completion_policy: "manual",
			progress: PROGRESS[i % PROGRESS.length],
			priority: PRIORITY[i % PRIORITY.length],
			rank: `z-d3-${String(i)}`,
		})) as never[],
	);

	// focus -> depth-1 (6 edges, cycling every kind)
	const focus_links = depth1_ids.map((dst_id, i) => ({
		...base_link,
		id: `link_density_focus-${String(i)}`,
		src_id: E2E_DENSITY_FOCUS,
		dst_id,
		kind: kindAt(i),
	}));

	// each depth-1 node -> 3 depth-2 nodes (18 edges)
	const d1_links = depth1_ids.flatMap((src_id, i) =>
		[0, 1, 2].map((j) => {
			const idx = i * 3 + j;
			return {
				...base_link,
				id: `link_density_d1-${String(i)}-${String(j)}`,
				src_id,
				dst_id: depth2_ids[idx],
				kind: kindAt(idx),
			};
		}),
	);

	// a spread of 5 depth-2 nodes -> depth-3 (5 edges)
	const d3_sources = [0, 3, 6, 9, 12];
	const d2_links = depth3_ids.map((dst_id, i) => ({
		...base_link,
		id: `link_density_d2-${String(i)}`,
		src_id: depth2_ids[d3_sources[i] ?? 0],
		dst_id,
		kind: kindAt(i),
	}));

	await db.insert(task_link).values([...focus_links, ...d1_links, ...d2_links] as never[]);
}

async function delete_density_fixtures(db: DrizzleDatabase): Promise<void> {
	const all_ids = [
		E2E_DENSITY_FOCUS,
		...Array.from({ length: E2E_DENSITY_DEPTH1_COUNT }, (_, i) => density_depth1_id(i)),
		...Array.from({ length: E2E_DENSITY_DEPTH2_COUNT }, (_, i) => density_depth2_id(i)),
		...Array.from({ length: E2E_DENSITY_DEPTH3_COUNT }, (_, i) => density_depth3_id(i)),
	];
	await db.delete(task_link).where(like(task_link.id, "link_density_%"));
	await db.delete(task).where(inArray(task.id, all_ids));
	await db.delete(project).where(eq(project.id, E2E_DENSITY_PROJECT_ID));
}
