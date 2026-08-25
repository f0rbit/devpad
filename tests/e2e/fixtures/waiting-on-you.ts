/**
 * @module tests/e2e/fixtures/waiting-on-you
 *
 * Typed seed fixture for the "Waiting on you" (task B2.4) Playwright spec.
 * One pending signoff checkpoint, riding on the already-seeded outline
 * project/user (same fixed ids) so this fixture has no extra project/user
 * setup of its own — see `waiting-on-you-ids.ts` for the re-export split.
 */
import { signoff, task } from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import { E2E_SIGNOFF_ID, E2E_TASK_WAITING_SIGNOFF, E2E_USER_ID, E2E_WAITING_PROJECT_ID } from "./waiting-on-you-ids";

export {
	E2E_SIGNOFF_ID,
	E2E_SESSION_ID,
	E2E_TASK_WAITING_SIGNOFF,
	E2E_USER_ID,
	E2E_WAITING_PROJECT_ID,
} from "./waiting-on-you-ids";

const SEED_NOW = new Date().toISOString();

export async function seed_waiting_on_you_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_waiting_on_you_fixtures(db);

	await db.insert(task).values({
		id: E2E_TASK_WAITING_SIGNOFF,
		owner_id: E2E_USER_ID,
		project_id: E2E_WAITING_PROJECT_ID,
		title: "E2E waiting-on-you approval checkpoint",
		kind: "approval",
		completion_policy: "manual",
		progress: "IN_PROGRESS",
		priority: "MEDIUM",
		visibility: "PRIVATE",
		parent_id: null,
		rank: "i9",
		rev: 0,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	// subject_kind "stage" (not "doc_version") deliberately — approving a
	// doc_version signoff looks up a real document + promotes its head
	// version, which would need a full corpus-backed document fixture just
	// to exercise the "Waiting on you" card/approve flow. "stage" skips that
	// document lookup entirely and goes straight to completing the linked
	// approval task, which is all this fixture needs to prove.
	await db.insert(signoff).values({
		id: E2E_SIGNOFF_ID,
		subject_kind: "stage",
		subject_id: "e2e-waiting-stage",
		checkpoint: "plan",
		task_id: E2E_TASK_WAITING_SIGNOFF,
		decision: null,
		decided_by: null,
		decided_at: null,
		reason: null,
		content_hash: null,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);
}

async function delete_waiting_on_you_fixtures(db: DrizzleDatabase): Promise<void> {
	await db.delete(signoff).where(eq(signoff.id, E2E_SIGNOFF_ID));
	await db.delete(task).where(eq(task.id, E2E_TASK_WAITING_SIGNOFF));
}
