import { Database as BunSqlite } from "bun:sqlite";
import { InMemoryCloudflareProvider, InMemoryPulseSummaryProvider } from "@devpad/pipeline-fakes";
import type { VersionBinding } from "@devpad/pipeline-fakes";
import type { PipelinePackage, User } from "@devpad/schema";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { pipeline_analysis_template, pipeline_package, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { ok, type Result } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import type { BundleFetchError, BundlePayload, BundleProvider } from "../../deploy.js";
import type { Dispatcher } from "../../dispatch.js";
import { InMemoryApprovalStore, InMemoryPulseEmitter } from "../../gates/__tests__/helpers.js";
import type { RunDeps } from "../../runs.js";

/**
 * In-memory bundle provider for tests. Returns a fixed stub bundle for
 * every `version_set_id` — most tests don't care about the bytes, just
 * that the deploy path can pull them. Tests that DO care about bundle
 * round-trip override this in a `cf.versions.upload` assertion against
 * the in-memory CF fake.
 */
export class InMemoryBundleProvider implements BundleProvider {
	bytes: Uint8Array = new TextEncoder().encode("export default { fetch: () => new Response('test') };");
	/** Platform bindings the bundle carries (vault/pulse in production). */
	bindings: BundlePayload["bindings"] = undefined;
	calls: Array<{ version_set_id: string; package_name: string; environment: "staging" | "production" }> = [];

	async get(input: {
		version_set_id: string;
		package_name: string;
		environment: "staging" | "production";
	}): Promise<Result<BundlePayload, BundleFetchError>> {
		this.calls.push(input);
		return ok({ kind: "single_file", bytes: this.bytes, bindings: this.bindings });
	}
}

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
		email_verified: now,
		image_url: "https://example.com/x.png",
		task_view: "list",
		created_at: now,
		updated_at: now,
	} as never);
	const rows = await db.select().from(user).where(eq(user.id, id));
	return rows[0]!;
}

export async function seed_package(
	db: Database,
	owner_id: string,
	overrides: Partial<PipelinePackage> = {},
): Promise<PipelinePackage> {
	const now = new Date().toISOString();
	const id = overrides.id ?? "pipeline-package_test";
	await db.insert(pipeline_package).values({
		id,
		owner_id,
		name: overrides.name ?? "test-pkg",
		repo_url: overrides.repo_url ?? null,
		default_template_ref: overrides.default_template_ref ?? null,
		deploy_mode: overrides.deploy_mode ?? "orchestrated",
		external_target: overrides.external_target ?? null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	});
	const rows = await db.select().from(pipeline_package).where(eq(pipeline_package.id, id));
	return rows[0]!;
}

export type TestDeps = RunDeps & {
	pulse: InMemoryPulseEmitter;
	approvals: InMemoryApprovalStore;
	cf: InMemoryCloudflareProvider;
	bundles: InMemoryBundleProvider;
	pulse_summary: InMemoryPulseSummaryProvider;
};

export function make_deps(db: Database, opts: { now?: () => number; dispatcher?: Dispatcher } = {}): TestDeps {
	const cf = new InMemoryCloudflareProvider();
	const bundles = new InMemoryBundleProvider();
	const pulse = new InMemoryPulseEmitter();
	const approvals = new InMemoryApprovalStore();
	const pulse_summary = new InMemoryPulseSummaryProvider();
	return { db, cf, bundles, pulse, approvals, pulse_summary, dispatcher: opts.dispatcher, now: opts.now };
}

/**
 * Read a run's stage events, newest last (insert order). Test-only
 * convenience used by the binding/failure suites to assert on
 * `deploy_failed` / `deploy_completed` payloads.
 */
export async function pipeline_stage_event_rows(db: Database, run_id: string) {
	return db.query.pipeline_stage_event.findMany({ where: (tbl, { eq: matches }) => matches(tbl.run_id, run_id) });
}

/**
 * Seed a script into existence in the in-memory CF fake WITHOUT creating
 * a deployment (#160): the orchestrator's binding read treats a script
 * with versions but no active deployment as "inherit from the latest
 * version", so this gives staged deploys something live to read while
 * keeping `deployments.list` counts untouched for existing suite
 * assertions. Used for the staging script that real packages create via
 * their own infra before the orchestrator ever promotes.
 */
export async function seed_script_version(
	cf: TestDeps["cf"],
	script_name: string,
	opts: { bindings?: VersionBinding[] } = {},
): Promise<void> {
	const seed = await cf.versions.upload({
		kind: "single_file",
		script_name,
		annotations: { "workers/tag": "orchestrator-seed" },
		bindings: opts.bindings,
	});
	if (!seed.ok) throw new Error(`seed_script_version(${script_name}) failed: ${seed.error.message}`);
}

/**
 * Test helper mirroring `resolve_script_name`'s convention:
 *   staging → `${name}-staging`, all others → `${name}`.
 *
 * The default `seed_package` fixture uses name = "test-pkg", which means
 * staging deploys land on `test-pkg-staging` and every other stage lands
 * on `test-pkg`. Callers that pre-seed a v0 deployment should seed it on
 * the non-staging script (where most of the run's deploys go); the
 * `staging` deploy lands on a separate script and shouldn't conflict.
 */
export const script_name_for = (opts: { name?: string; stage_name?: string } = {}): string => {
	const name = opts.name ?? "test-pkg";
	if (opts.stage_name === "staging") return `${name}-staging`;
	return name;
};

/**
 * Seed a `pipeline_analysis_template` row with the given threshold DSL.
 * Defaults to a forgiving template (window=600_000 ms, error_rate<0.01).
 */
export async function seed_analysis_template(
	db: Database,
	owner_id: string,
	overrides: { id?: string; name?: string; threshold_dsl?: string; query_dsl?: unknown; window_ms?: number } = {},
): Promise<{ id: string }> {
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
