import { Database as BunSqlite } from "bun:sqlite";
import { InMemoryCloudflareProvider, InMemoryPulseSummaryProvider } from "@devpad/pipeline-fakes";
import type { PipelinePackage, User } from "@devpad/schema";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { pipeline_analysis_template, pipeline_package, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { InMemoryApprovalStore, InMemoryPulseEmitter } from "../../gates/__tests__/helpers.js";
import type { RunDeps } from "../../runs.js";

export function create_test_db(): Database {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
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

export type TestDeps = RunDeps & {
	pulse: InMemoryPulseEmitter;
	approvals: InMemoryApprovalStore;
	cf: InMemoryCloudflareProvider;
	pulse_summary: InMemoryPulseSummaryProvider;
};

export function make_deps(db: Database, opts: { now?: () => number } = {}): TestDeps {
	const cf = new InMemoryCloudflareProvider();
	const pulse = new InMemoryPulseEmitter();
	const approvals = new InMemoryApprovalStore();
	const pulse_summary = new InMemoryPulseSummaryProvider();
	return { db, cf, pulse, approvals, pulse_summary, now: opts.now };
}

export const script_name_for = (package_id: string): string => `pipeline_${package_id}`;

/**
 * Seed a `pipeline_analysis_template` row with the given threshold DSL.
 * Defaults to a forgiving template (window=600_000 ms, error_rate<0.01).
 */
export async function seed_analysis_template(db: Database, owner_id: string, overrides: { id?: string; name?: string; threshold_dsl?: string; query_dsl?: unknown; window_ms?: number } = {}): Promise<{ id: string }> {
	const now = new Date().toISOString();
	const id = overrides.id ?? "pipeline-analysis-template_default";
	await db.insert(pipeline_analysis_template).values({
		id,
		owner_id,
		name: overrides.name ?? "default-analysis",
		query_dsl: (overrides.query_dsl ?? {}) as never,
		threshold_dsl: (overrides.threshold_dsl ?? "error_rate < 0.01") as never,
		window_ms: overrides.window_ms ?? 600_000,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
	return { id };
}
