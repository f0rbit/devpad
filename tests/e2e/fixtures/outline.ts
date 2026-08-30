/**
 * @module tests/e2e/fixtures/outline
 *
 * Typed seed fixture for the v2.4 outline Playwright suite (task B1). Mirrors
 * `pipelines.ts`'s structure — same `open_test_db` helper, same
 * delete-then-insert idempotency, same fixed-id-with-node-safe-re-export
 * split (see `outline-ids.ts`).
 *
 * Tree shape:
 *   phase (auto_children)
 *     ├─ child-1  (IN_PROGRESS, HIGH priority, claimed)
 *     └─ child-2  (UNSTARTED, LOW priority, blocked by leaf)
 *   leaf  (root-level, blocks child-2)
 *   compact-parent (auto_children, dedicated — see outline-ids.ts)
 *     └─ compact-child  (IN_PROGRESS)
 *
 * `task_rollup` is seeded to match each parent's (incomplete) children so
 * the outline's progress ring renders a real fraction rather than 0/0.
 */

import {
	hook,
	hook_delivery,
	project,
	project_view_state,
	session,
	task,
	task_link,
	task_rollup,
	user,
} from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_CHILD_1,
	E2E_TASK_CHILD_2,
	E2E_TASK_COMPACT_CHILD,
	E2E_TASK_COMPACT_PARENT,
	E2E_TASK_LEAF,
	E2E_TASK_MILESTONE,
	E2E_TASK_MILESTONE_2,
	E2E_TASK_MILESTONE_2_CHILD,
	E2E_TASK_MILESTONE_CHILD,
	E2E_TASK_PHASE,
	E2E_TASK_RIPPLE_GRANDPARENT,
	E2E_TASK_RIPPLE_LEAF,
	E2E_TASK_RIPPLE_PARENT,
	E2E_HOOK_DELIVERY_DLQ_ID,
	E2E_HOOK_ID,
	E2E_TASK_RIPPLE_REDUCED_LEAF,
	E2E_TASK_RIPPLE_REDUCED_PARENT,
	E2E_TASK_STAGE_PLAN,
	E2E_TASK_STAGE_REVIEW,
	E2E_USER_ID,
} from "./outline-ids";
import { open_test_db } from "./pipelines";

export { open_test_db };
export {
	E2E_OUTLINE_PROJECT_ID,
	E2E_SESSION_ID,
	E2E_TASK_CHILD_1,
	E2E_TASK_CHILD_2,
	E2E_TASK_COMPACT_CHILD,
	E2E_TASK_COMPACT_PARENT,
	E2E_TASK_LEAF,
	E2E_TASK_MILESTONE,
	E2E_TASK_MILESTONE_2,
	E2E_TASK_MILESTONE_2_CHILD,
	E2E_TASK_MILESTONE_CHILD,
	E2E_TASK_PHASE,
	E2E_TASK_RIPPLE_GRANDPARENT,
	E2E_TASK_RIPPLE_LEAF,
	E2E_TASK_RIPPLE_PARENT,
	E2E_HOOK_DELIVERY_DLQ_ID,
	E2E_HOOK_ID,
	E2E_TASK_RIPPLE_REDUCED_LEAF,
	E2E_TASK_RIPPLE_REDUCED_PARENT,
	E2E_TASK_STAGE_PLAN,
	E2E_TASK_STAGE_REVIEW,
	E2E_USER_ID,
};

const SEED_NOW = new Date().toISOString();
const SESSION_EXPIRES_AT = 4_070_908_800; // 2099-01-01T00:00:00Z, same fixed far-future expiry as the pipelines fixture

export async function seed_outline_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_outline_fixtures(db);

	// user/session live on the SAME fixed ids the pipelines fixture seeds —
	// `onConflictDoNothing` rather than delete-then-insert, so whichever seed
	// runs second doesn't fight the first for rows neither fixture exclusively
	// owns (and never risks a dangling FK from the OTHER fixture's projects).
	await db
		.insert(user)
		.values({
			id: E2E_USER_ID,
			name: "E2E Test User",
			email: `${E2E_USER_ID}@test.example`,
			email_verified: SEED_NOW,
			image_url: "https://example.com/x.png",
			task_view: "list",
			github_id: 900_000_002,
			created_at: SEED_NOW,
			updated_at: SEED_NOW,
		} as never)
		.onConflictDoNothing();

	await db
		.insert(session)
		.values({
			id: E2E_SESSION_ID,
			userId: E2E_USER_ID,
			expiresAt: SESSION_EXPIRES_AT,
			access_token: null,
		} as never)
		.onConflictDoNothing();

	await db.insert(project).values({
		id: E2E_OUTLINE_PROJECT_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-outline-project",
		project_id: E2E_OUTLINE_PROJECT_ID,
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
		project_id: E2E_OUTLINE_PROJECT_ID,
		visibility: "PRIVATE" as const,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user" as const,
		modified_by: "user" as const,
		protected: false,
		deleted: false,
		rev: 0,
	};

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_PHASE,
		title: "Ripple UI",
		kind: "phase",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		rank: "i0",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_CHILD_1,
		title: "Build outline rows",
		kind: "task",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "HIGH",
		claimed_by: "agent-1",
		claimed_at: SEED_NOW,
		parent_id: E2E_TASK_PHASE,
		rank: "i1",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_CHILD_2,
		title: "Wire zoom breadcrumbs",
		kind: "task",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: E2E_TASK_PHASE,
		rank: "i2",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_LEAF,
		title: "Standalone leaf task",
		kind: "task",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		rank: "i3",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_COMPACT_PARENT,
		title: "Compactable phase",
		kind: "phase",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		rank: "i4",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_COMPACT_CHILD,
		title: "Only child",
		kind: "task",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "LOW",
		parent_id: E2E_TASK_COMPACT_PARENT,
		rank: "i0",
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_COMPACT_PARENT,
		direct_done: 0,
		direct_total: 1,
		subtree_done: 0,
		subtree_total: 1,
	} as never);

	await db.insert(task_link).values({
		id: `link_${E2E_TASK_LEAF}-blocks-${E2E_TASK_CHILD_2}`,
		src_id: E2E_TASK_LEAF,
		dst_id: E2E_TASK_CHILD_2,
		kind: "blocks",
		ref: null,
		note: null,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_PHASE,
		direct_done: 0,
		direct_total: 2,
		subtree_done: 0,
		subtree_total: 2,
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_MILESTONE,
		title: "Ripple v1",
		kind: "milestone",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		end_time: "2099-01-01T00:00:00.000Z",
		rank: "i5",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_MILESTONE_CHILD,
		title: "Ship the ripple lens",
		kind: "task",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: E2E_TASK_MILESTONE,
		rank: "i0",
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_MILESTONE,
		direct_done: 0,
		direct_total: 1,
		subtree_done: 0,
		subtree_total: 1,
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_MILESTONE_2,
		title: "Ripple v2",
		kind: "milestone",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		end_time: "2099-02-01T00:00:00.000Z",
		rank: "i5a",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_MILESTONE_2_CHILD,
		title: "Polish the ripple lens",
		kind: "task",
		completion_policy: "manual",
		progress: "COMPLETED",
		priority: "LOW",
		parent_id: E2E_TASK_MILESTONE_2,
		rank: "i0",
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_MILESTONE_2,
		direct_done: 1,
		direct_total: 1,
		subtree_done: 1,
		subtree_total: 1,
	} as never);

	await db.insert(task_link).values({
		id: `link_${E2E_TASK_MILESTONE}-blocks-${E2E_TASK_MILESTONE_2}`,
		src_id: E2E_TASK_MILESTONE,
		dst_id: E2E_TASK_MILESTONE_2,
		kind: "blocks",
		ref: null,
		note: null,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_RIPPLE_GRANDPARENT,
		title: "Ripple grandparent",
		kind: "phase",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		rank: "i6",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_RIPPLE_PARENT,
		title: "Ripple parent",
		kind: "phase",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: E2E_TASK_RIPPLE_GRANDPARENT,
		rank: "i0",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_RIPPLE_LEAF,
		title: "Ripple leaf",
		kind: "task",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "LOW",
		parent_id: E2E_TASK_RIPPLE_PARENT,
		rank: "i0",
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_RIPPLE_GRANDPARENT,
		direct_done: 0,
		direct_total: 1,
		subtree_done: 0,
		subtree_total: 1,
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_RIPPLE_PARENT,
		direct_done: 0,
		direct_total: 1,
		subtree_done: 0,
		subtree_total: 1,
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_RIPPLE_REDUCED_PARENT,
		title: "Ripple reduced-motion parent",
		kind: "phase",
		completion_policy: "auto_children",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		rank: "i7",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_RIPPLE_REDUCED_LEAF,
		title: "Ripple reduced-motion leaf",
		kind: "task",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "LOW",
		parent_id: E2E_TASK_RIPPLE_REDUCED_PARENT,
		rank: "i0",
	} as never);

	await db.insert(task_rollup).values({
		task_id: E2E_TASK_RIPPLE_REDUCED_PARENT,
		direct_done: 0,
		direct_total: 1,
		subtree_done: 0,
		subtree_total: 1,
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_STAGE_PLAN,
		title: "Stage-tracked task (plan)",
		kind: "task",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		stage: "plan",
		rank: "i8",
	} as never);

	await db.insert(task).values({
		...base_task,
		id: E2E_TASK_STAGE_REVIEW,
		title: "Stage-tracked task (review)",
		kind: "task",
		completion_policy: "manual",
		progress: "UNSTARTED",
		priority: "LOW",
		parent_id: null,
		stage: "review",
		rank: "i9",
	} as never);

	await db.insert(task_link).values({
		id: `link_${E2E_TASK_STAGE_REVIEW}-tracks_metric`,
		src_id: E2E_TASK_STAGE_REVIEW,
		dst_id: null,
		kind: "tracks_metric",
		ref: { metric_name: "error_rate" },
		note: null,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(hook).values({
		id: E2E_HOOK_ID,
		project_id: E2E_OUTLINE_PROJECT_ID,
		enabled: true,
		trigger: { kinds: ["task.completed"], selector: {} },
		action: { kind: "webhook", url: "https://example.com/e2e-hook" },
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	// No API can fabricate a `hook_delivery` row directly (only the dispatch
	// system ever creates one) — this is the one part of the settings
	// fixture that has to be seeded at the SQL level.
	await db.insert(hook_delivery).values({
		id: E2E_HOOK_DELIVERY_DLQ_ID,
		hook_id: E2E_HOOK_ID,
		event_id: "event_e2e-dlq-sample",
		status: "failed_permanent",
		attempts: 3,
		last_error: "connect ECONNREFUSED 127.0.0.1:9999",
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
	} as never);
}

async function delete_outline_fixtures(db: DrizzleDatabase): Promise<void> {
	await db.delete(project_view_state).where(eq(project_view_state.project_id, E2E_OUTLINE_PROJECT_ID));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_PHASE));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_COMPACT_PARENT));
	await db.delete(task_link).where(eq(task_link.id, `link_${E2E_TASK_LEAF}-blocks-${E2E_TASK_CHILD_2}`));
	await db.delete(task).where(eq(task.id, E2E_TASK_CHILD_1));
	await db.delete(task).where(eq(task.id, E2E_TASK_CHILD_2));
	await db.delete(task).where(eq(task.id, E2E_TASK_LEAF));
	await db.delete(task).where(eq(task.id, E2E_TASK_PHASE));
	await db.delete(task).where(eq(task.id, E2E_TASK_COMPACT_CHILD));
	await db.delete(task).where(eq(task.id, E2E_TASK_COMPACT_PARENT));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_MILESTONE));
	await db.delete(task_link).where(eq(task_link.id, `link_${E2E_TASK_MILESTONE}-blocks-${E2E_TASK_MILESTONE_2}`));
	await db.delete(task).where(eq(task.id, E2E_TASK_MILESTONE_CHILD));
	await db.delete(task).where(eq(task.id, E2E_TASK_MILESTONE));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_MILESTONE_2));
	await db.delete(task).where(eq(task.id, E2E_TASK_MILESTONE_2_CHILD));
	await db.delete(task).where(eq(task.id, E2E_TASK_MILESTONE_2));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_RIPPLE_GRANDPARENT));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_RIPPLE_PARENT));
	await db.delete(task).where(eq(task.id, E2E_TASK_RIPPLE_LEAF));
	await db.delete(task).where(eq(task.id, E2E_TASK_RIPPLE_PARENT));
	await db.delete(task).where(eq(task.id, E2E_TASK_RIPPLE_GRANDPARENT));
	await db.delete(task_rollup).where(eq(task_rollup.task_id, E2E_TASK_RIPPLE_REDUCED_PARENT));
	await db.delete(task).where(eq(task.id, E2E_TASK_RIPPLE_REDUCED_LEAF));
	await db.delete(task).where(eq(task.id, E2E_TASK_RIPPLE_REDUCED_PARENT));
	await db.delete(task_link).where(eq(task_link.id, `link_${E2E_TASK_STAGE_REVIEW}-tracks_metric`));
	await db.delete(task).where(eq(task.id, E2E_TASK_STAGE_PLAN));
	await db.delete(task).where(eq(task.id, E2E_TASK_STAGE_REVIEW));
	await db.delete(hook_delivery).where(eq(hook_delivery.id, E2E_HOOK_DELIVERY_DLQ_ID));
	await db.delete(hook).where(eq(hook.id, E2E_HOOK_ID));
	await db.delete(project).where(eq(project.id, E2E_OUTLINE_PROJECT_ID));
	// user/session are shared with the pipelines fixture on the same fixed ids
	// (see the `onConflictDoNothing` inserts above) — never deleted here.
}
