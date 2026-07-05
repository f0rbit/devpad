/**
 * @module tests/e2e/fixtures/pipelines
 *
 * Typed seed fixture for the pipelines Playwright suite. Opens the repo-root
 * `database/test.db` with the SAME drizzle helpers the worker dev server uses
 * (`createBunDatabase` / `migrateBunDatabase` from `@devpad/schema/database/bun`)
 * so the migrated schema matches exactly. Seeds — idempotently, via
 * delete-then-insert on FIXED ids — a user, a project, a pipeline_package, and
 * two pipeline_run rows (one completed + one awaiting_approval) plus one
 * analysis_template, mirroring the insert shapes in
 * `packages/worker/src/__tests__/pipelines-dashboard.test.ts` (`seed_baseline`)
 * and `packages/pipelines/__tests__/integration/helpers.ts`.
 *
 * The fixed ids are exported as constants so specs import them rather than
 * hardcoding strings (single source of truth).
 *
 * Determinism: all time-derived fields use FIXED ISO timestamps (no `Date.now()`),
 * so dashboard latency/counts are fully reproducible across runs.
 *
 * Lifecycle: `open_test_db` returns the raw `sqlite` handle alongside `db`;
 * callers MUST `sqlite.close()` once seeding is done. The worker server is the
 * live writer — we seed once with the handle closed to avoid SQLite
 * multi-writer contention.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import {
	pipeline_analysis_template,
	pipeline_package,
	pipeline_run,
	project,
	session,
	user,
} from "@devpad/schema/database/schema";
import type { Database as DrizzleDatabase } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import {
	E2E_AWAITING_STAGE,
	E2E_PKG_ID,
	E2E_PROJECT_ID,
	E2E_PROJECT_NO_PKG,
	E2E_RUN_AWAITING,
	E2E_RUN_COMPLETED,
	E2E_SESSION_ID,
	E2E_TEMPLATE_ID,
	E2E_USER_ID,
} from "./pipeline-ids";

/**
 * Re-export the fixture ids from the node-safe `./pipeline-ids` module (single
 * source of truth). Specs import ids from `./pipeline-ids` directly to avoid
 * pulling `bun:sqlite` into Playwright's node loader; the seed imports them here.
 */
export {
	E2E_AWAITING_STAGE,
	E2E_PKG_ID,
	E2E_PROJECT_ID,
	E2E_PROJECT_NO_PKG,
	E2E_RUN_AWAITING,
	E2E_RUN_COMPLETED,
	E2E_SESSION_ID,
	E2E_TEMPLATE_ID,
	E2E_USER_ID,
};

/** Far-future session expiry (unix seconds, fixed): 2099-01-01T00:00:00Z. */
const SESSION_EXPIRES_AT = 4_070_908_800;

/**
 * Timestamps are WINDOW-RELATIVE, computed at seed time, NOT fixed calendar
 * dates. The dashboard aggregator filters runs by `started_at >= now - window_ms`
 * (see `packages/core/src/services/pipelines/dashboard.ts`); the smallest UI
 * window is 24h. A fixed past date would fall outside every selectable window so
 * the dashboard would report 0 runs and the count assertions would be hollow.
 * Anchoring the runs ~2h before "now" keeps both inside the default 24h window
 * on every run, so `run_counts.total` is deterministically 2. The exact instant
 * varies run-to-run but the COUNTS (total=2, completed=1) do not, which is all
 * the dashboard spec asserts.
 */
const SEED_AT = Date.now();
const SEED_NOW = new Date(SEED_AT).toISOString();
const RUN_STARTED = new Date(SEED_AT - 2 * 60 * 60 * 1000).toISOString();
const RUN_FINISHED = new Date(SEED_AT - 2 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString();

/**
 * Open `file` with the shipped bun drizzle helpers, creating + migrating it if
 * absent (`migrateBunDatabase` is idempotent). Returns the raw `sqlite` handle
 * so the caller can `sqlite.close()` after seeding.
 *
 * Ensures the parent directory exists first: bun:sqlite cannot create a db file
 * inside a non-existent directory, and `database/` is gitignored so it is absent
 * on a clean CI checkout. `mkdirSync(..., { recursive: true })` is idempotent.
 */
export function open_test_db(file: string): { sqlite: Database; db: DrizzleDatabase } {
	mkdirSync(dirname(file), { recursive: true });
	const sqlite = new Database(file);
	migrateBunDatabase(sqlite);
	const db = createBunDatabase(sqlite);
	return { sqlite, db };
}

/**
 * Delete-then-insert the fixture rows on the fixed ids. Idempotent: running
 * twice yields the same state. Children are deleted before parents (FK order)
 * and parents inserted before children.
 */
export async function seed_pipeline_fixtures(db: DrizzleDatabase): Promise<void> {
	await delete_fixtures(db);

	await db.insert(user).values({
		id: E2E_USER_ID,
		name: "E2E Test User",
		email: `${E2E_USER_ID}@test.example`,
		email_verified: SEED_NOW,
		image_url: "https://example.com/x.png",
		task_view: "list",
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
	} as never);

	await db.insert(session).values({
		id: E2E_SESSION_ID,
		userId: E2E_USER_ID,
		expiresAt: SESSION_EXPIRES_AT,
		access_token: null,
	} as never);

	await db.insert(project).values({
		id: E2E_PROJECT_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-pipeline-project",
		project_id: E2E_PROJECT_ID,
		visibility: "PRIVATE",
		status: "DEVELOPMENT",
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	// A second project owned by the same fake user with NO pipeline_package, for
	// the degradation spec's no-package case.
	await db.insert(project).values({
		id: E2E_PROJECT_NO_PKG,
		owner_id: E2E_USER_ID,
		name: "e2e-pipeline-no-pkg",
		project_id: E2E_PROJECT_NO_PKG,
		visibility: "PRIVATE",
		status: "DEVELOPMENT",
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "user",
		modified_by: "user",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(pipeline_package).values({
		id: E2E_PKG_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-pkg",
		repo_url: null,
		default_template_ref: null,
		project_id: E2E_PROJECT_ID,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(pipeline_run).values({
		id: E2E_RUN_COMPLETED,
		package_id: E2E_PKG_ID,
		version_set_id: "vs_v1",
		shape: "atomic",
		kind: "deploy",
		status: "completed",
		current_stage: null,
		resolved_rollout: { type: "atomic" } as never,
		resolved_gates: {} as never,
		forced_atomic_reason: null,
		started_at: RUN_STARTED,
		finished_at: RUN_FINISHED,
		created_at: RUN_STARTED,
		updated_at: RUN_FINISHED,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(pipeline_run).values({
		id: E2E_RUN_AWAITING,
		package_id: E2E_PKG_ID,
		version_set_id: "vs_v1",
		shape: "atomic",
		kind: "deploy",
		status: "awaiting_approval",
		current_stage: E2E_AWAITING_STAGE,
		resolved_rollout: { type: "atomic" } as never,
		resolved_gates: { [`staging→${E2E_AWAITING_STAGE}`]: { type: "manual" } } as never,
		forced_atomic_reason: null,
		started_at: RUN_STARTED,
		finished_at: null,
		created_at: RUN_STARTED,
		updated_at: RUN_STARTED,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);

	await db.insert(pipeline_analysis_template).values({
		id: E2E_TEMPLATE_ID,
		owner_id: E2E_USER_ID,
		name: "e2e-template",
		query_dsl: { metric: "error_rate" } as never,
		threshold_dsl: { max: 0.05 } as never,
		window_ms: 600_000,
		created_at: SEED_NOW,
		updated_at: SEED_NOW,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
}

async function delete_fixtures(db: DrizzleDatabase): Promise<void> {
	await db.delete(pipeline_run).where(eq(pipeline_run.id, E2E_RUN_AWAITING));
	await db.delete(pipeline_run).where(eq(pipeline_run.id, E2E_RUN_COMPLETED));
	await db.delete(pipeline_analysis_template).where(eq(pipeline_analysis_template.id, E2E_TEMPLATE_ID));
	await db.delete(pipeline_package).where(eq(pipeline_package.id, E2E_PKG_ID));
	await db.delete(project).where(eq(project.id, E2E_PROJECT_NO_PKG));
	await db.delete(project).where(eq(project.id, E2E_PROJECT_ID));
	await db.delete(session).where(eq(session.id, E2E_SESSION_ID));
	await db.delete(user).where(eq(user.id, E2E_USER_ID));
}
