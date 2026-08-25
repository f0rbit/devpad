import { Database as BunSqlite } from "bun:sqlite";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Task, User } from "@devpad/schema";
import { BUN_MIGRATIONS_DIR, createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { project, task, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";

/** In-memory bun:sqlite database, migrated — mirrors the pipelines createBunDatabase harness. */
export function create_test_db(): Database {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
}

const FOLD_BACKFILL_TAG = "0021_v24_fold_backfill";

type Journal = {
	version: string;
	dialect: string;
	entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};

/** Copies every migration BEFORE the fold backfill into a scratch folder — lets
 * `create_pre_fold_db` apply "everything except the fold" without hand-rolling
 * a second migrations folder that could drift from the real one. */
function build_pre_fold_migrations_dir(): string {
	const journal_path = join(BUN_MIGRATIONS_DIR, "meta/_journal.json");
	const journal = JSON.parse(readFileSync(journal_path, "utf-8")) as Journal;
	const fold_index = journal.entries.findIndex((e) => e.tag === FOLD_BACKFILL_TAG);
	if (fold_index < 0) throw new Error(`build_pre_fold_migrations_dir: ${FOLD_BACKFILL_TAG} not found in journal`);
	const pre_entries = journal.entries.slice(0, fold_index);
	const dir = mkdtempSync(join(tmpdir(), "devpad-pre-fold-"));
	mkdirSync(join(dir, "meta"), { recursive: true });
	writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: pre_entries }));
	for (const entry of pre_entries) {
		cpSync(join(BUN_MIGRATIONS_DIR, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
	}
	return dir;
}

/**
 * A database migrated up to (but NOT including) the v2.4 fold backfill
 * (task A5.1) — lets a test seed legacy `milestone`/`goal`/`task` rows
 * exactly as they'd exist in production the instant before the fold
 * migration runs, then apply just that one migration via
 * `apply_fold_migration` and assert on the result.
 */
export function create_pre_fold_db(): { sqlite: BunSqlite; db: Database } {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite, build_pre_fold_migrations_dir());
	return { sqlite, db: createBunDatabase(sqlite) };
}

/**
 * Applies every not-yet-applied migration against `sqlite` — in practice
 * just the fold backfill, since `create_pre_fold_db` already applied
 * everything before it. drizzle-orm's migrator skips already-applied
 * migrations by content hash, so calling this twice is the idempotency test
 * itself: the second call re-applies nothing.
 */
export function apply_fold_migration(sqlite: BunSqlite): void {
	migrateBunDatabase(sqlite, BUN_MIGRATIONS_DIR);
}

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

let user_counter = 0;
export async function seed_user(db: Database, overrides: Partial<User> = {}): Promise<User> {
	const id = overrides.id ?? `user_test_${String(++user_counter)}`;
	const now = new Date().toISOString();
	await db.insert(user).values({
		id,
		name: overrides.name ?? "tester",
		email: overrides.email ?? `${id}@test.example`,
		email_verified: now,
		image_url: "https://example.com/x.png",
		task_view: "list",
	} as never);
	const rows = await db.select().from(user).where(eq(user.id, id));
	return rows[0]!;
}

let task_counter = 0;
export async function seed_task(db: Database, owner_id: string, overrides: Partial<Task> = {}): Promise<Task> {
	const id = overrides.id ?? `task_test_${String(++task_counter)}`;
	await db.insert(task).values({
		id,
		owner_id,
		title: overrides.title ?? `Test task ${id}`,
		progress: overrides.progress ?? "UNSTARTED",
		visibility: overrides.visibility ?? "PRIVATE",
		priority: overrides.priority ?? "MEDIUM",
		parent_id: overrides.parent_id ?? null,
		rank: overrides.rank ?? "",
		rev: overrides.rev ?? 0,
		kind: overrides.kind ?? "task",
		completion_policy: overrides.completion_policy ?? "manual",
		completed_via: overrides.completed_via ?? null,
		project_id: overrides.project_id ?? null,
		goal_id: overrides.goal_id ?? null,
		start_time: overrides.start_time ?? null,
		end_time: overrides.end_time ?? null,
		deleted: overrides.deleted ?? false,
		stage: overrides.stage ?? null,
	} as never);
	const rows = await db.select().from(task).where(eq(task.id, id));
	return rows[0]!;
}
