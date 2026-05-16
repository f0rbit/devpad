import { Database as BunSqlite } from "bun:sqlite";
import { resolve } from "node:path";
import { InMemoryCloudflareProvider } from "@devpad/pipeline-fakes";
import type { PipelinePackage, User } from "@devpad/schema";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { pipeline_package, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { InMemoryApprovalStore, InMemoryPulseEmitter } from "../../gates/__tests__/helpers.js";
import type { RunDeps } from "../../runs.js";

const MIGRATIONS_DIR = resolve(import.meta.dir, "../../../../../../schema/src/database/drizzle");

export function create_test_db(): Database {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite, MIGRATIONS_DIR);
	return createBunDatabase(sqlite);
}

export async function seed_user(db: Database, id = "user_test"): Promise<User> {
	const now = new Date().toISOString();
	await db.insert(user).values({
		id,
		name: "tester",
		email: `${id}@test.example`,
		email_verified: true,
		image_url: "https://example.com/x.png",
		task_view: "list",
		created_at: now,
		updated_at: now,
	} as never);
	const rows = await db.select().from(user);
	return rows[0]!;
}

export async function seed_package(db: Database, owner_id: string, overrides: Partial<PipelinePackage> = {}): Promise<PipelinePackage> {
	const now = new Date().toISOString();
	const id = overrides.id ?? "pipeline-package_test";
	await db.insert(pipeline_package).values({
		id,
		owner_id,
		name: overrides.name ?? "test-pkg",
		repo_url: overrides.repo_url ?? null,
		default_template_ref: overrides.default_template_ref ?? null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
	const rows = await db.select().from(pipeline_package);
	return rows[0]!;
}

export function make_deps(db: Database): RunDeps & { pulse: InMemoryPulseEmitter; approvals: InMemoryApprovalStore; cf: InMemoryCloudflareProvider } {
	const cf = new InMemoryCloudflareProvider();
	const pulse = new InMemoryPulseEmitter();
	const approvals = new InMemoryApprovalStore();
	return { db, cf, pulse, approvals };
}

export const script_name_for = (package_id: string): string => `pipeline_${package_id}`;
