import { Database as BunSqlite } from "bun:sqlite";
import type { Task, User } from "@devpad/schema";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { task, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";

/** In-memory bun:sqlite database, migrated — mirrors the pipelines createBunDatabase harness. */
export function create_test_db(): Database {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
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
		project_id: overrides.project_id ?? null,
		goal_id: overrides.goal_id ?? null,
		start_time: overrides.start_time ?? null,
		end_time: overrides.end_time ?? null,
		deleted: overrides.deleted ?? false,
	} as never);
	const rows = await db.select().from(task).where(eq(task.id, id));
	return rows[0]!;
}
