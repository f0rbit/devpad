/**
 * @module pipelines/__tests__/integration/helpers
 *
 * Test substrate for the orchestrator routes + DO. Composes:
 *
 * - bun:sqlite + migrate → real Database
 * - InMemoryCloudflareProvider, InMemoryPulseEmitter, InMemoryApprovalStore
 *   → real `RunDeps`
 * - InMemoryDurableObjectNamespace → real DO routing without
 *   miniflare
 * - Static template + manifest + lineage providers
 * - Hono routes from `make_routes`, deps injected, no miniflare
 */

import { Database as BunSqlite } from "bun:sqlite";
import type { BundleFetchError, BundlePayload, BundleProvider, RunDeps } from "@devpad/core/services/pipelines";
import type { Decision, EmitError, PulseEvent, StoreError } from "@devpad/core/services/pipelines/gates";
import { InMemoryCloudflareProvider, InMemoryDurableObjectNamespace, type InMemoryDurableObjectState } from "@devpad/pipeline-fakes";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import type { ApprovalDecision, PipelinePackage, User } from "@devpad/schema";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { pipeline_package, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Result, VersionSetManifest } from "@f0rbit/corpus";
import { ok } from "@f0rbit/corpus";
// Import from source modules directly (NOT `../../src/index.ts`) so the
// test bundle skips `grants-rpc-entrypoint.ts`, which pulls in the
// `cloudflare:workers` runtime-only module that bun can't resolve.
import { type LineageProvider, type ManifestProvider, make_routes, type RoutesDeps, type TemplateResolver } from "../../src/routes.ts";
import { type DoCtx, make_run_handler } from "../../src/run-do.ts";

/**
 * Test helper mirroring `resolve_script_name`'s convention:
 *   staging → `${name}-staging`, all others → `${name}`.
 *
 * The default `seed_package` fixture uses name = "test-pkg" — staging
 * deploys land on `test-pkg-staging`, everything else on `test-pkg`.
 */
export const SCRIPT_NAME_FOR = (opts: { name?: string; stage_name?: string } = {}): string => {
	const name = opts.name ?? "test-pkg";
	if (opts.stage_name === "staging") return `${name}-staging`;
	return name;
};

export class InMemoryPulseEmitter {
	emitted: PulseEvent[] = [];
	async emit(event: PulseEvent): Promise<Result<void, EmitError>> {
		this.emitted.push(event);
		return ok(undefined);
	}
}

export class InMemoryBundleProvider implements BundleProvider {
	bytes: Uint8Array = new TextEncoder().encode("export default {};");
	calls: Array<{ version_set_id: string; package_name: string; environment: "staging" | "production" }> = [];
	async get(input: { version_set_id: string; package_name: string; environment: "staging" | "production" }): Promise<Result<BundlePayload, BundleFetchError>> {
		this.calls.push(input);
		return ok({ bytes: this.bytes });
	}
}

export class InMemoryApprovalStore {
	private decisions = new Map<string, Decision>();
	private pending = new Set<string>();
	async write_pending(run_id: string, stage: string): Promise<Result<void, StoreError>> {
		this.pending.add(`${run_id}:${stage}`);
		return ok(undefined);
	}
	async read_decision(run_id: string, stage: string): Promise<Result<Decision | null, StoreError>> {
		return ok(this.decisions.get(`${run_id}:${stage}`) ?? null);
	}
	async write_decision(run_id: string, stage: string, decision: Decision): Promise<Result<void, StoreError>> {
		this.decisions.set(`${run_id}:${stage}`, decision);
		return ok(undefined);
	}
}

export const create_test_db = (): Database => {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
};

export const seed_user = async (db: Database, id = "user_test"): Promise<User> => {
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
};

export const seed_package = async (db: Database, owner_id: string, id = "pipeline-package_test"): Promise<PipelinePackage> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_package).values({
		id,
		owner_id,
		name: "test-pkg",
		repo_url: null,
		default_template_ref: null,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
	const rows = await db.select().from(pipeline_package);
	return rows[0]!;
};

export const default_manifest: VersionSetManifest = {
	package: "test-pkg",
	git_sha: "abc123",
	created_at: "2026-05-16T00:00:00Z",
	builds: { worker: { artifact_ref: "r2://worker/v1", size_bytes: 1024, compatibility_date: "2025-01-01" } },
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env/v1",
	infra_plan_ref: "r2://infra/v1",
};

export const make_run_deps = (db: Database): RunDeps & { cf: InMemoryCloudflareProvider; bundles: InMemoryBundleProvider; pulse: InMemoryPulseEmitter; approvals: InMemoryApprovalStore } => {
	const cf = new InMemoryCloudflareProvider();
	const bundles = new InMemoryBundleProvider();
	const pulse = new InMemoryPulseEmitter();
	const approvals = new InMemoryApprovalStore();
	return { db, cf, bundles, pulse, approvals };
};

export type TestHarness = {
	db: Database;
	deps: ReturnType<typeof make_run_deps>;
	template: PipelineTemplate;
	pkg: PipelinePackage;
	manifest_for: Map<string, VersionSetManifest>;
	app: ReturnType<typeof make_routes>;
	namespace: InMemoryDurableObjectNamespace<{ deps: RunDeps }>;
	previous_for: Map<string, string>;
	fire_alarm: (run_id: string) => Promise<void>;
};

export const build_harness = async (options?: { template?: PipelineTemplate }): Promise<TestHarness> => {
	const db = create_test_db();
	const u = await seed_user(db);
	const pkg = await seed_package(db, u.id);
	const deps = make_run_deps(db);

	const built = options?.template !== undefined ? { ok: true as const, value: options.template } : extendTemplate({});
	if (!built.ok) throw new Error(`template build failed: ${JSON.stringify(built.error)}`);
	const template = built.value;

	// Pre-seed v0 on the non-staging script — that's where onebox/wave* and
	// atomic-prod land. Staging deploys to its own `${name}-staging` script.
	const script = SCRIPT_NAME_FOR();
	const v0 = await deps.cf.versions.upload({ script_name: script, annotations: { "workers/tag": "vs_v0" } });
	if (!v0.ok) throw new Error("v0 upload failed");
	await deps.cf.deployments.create({
		script_name: script,
		strategy: { strategy: "percentage", versions: [{ version_id: v0.value.id, percentage: 100 }] },
	});

	// vs_v0 also has a manifest so the new rollback route (which creates
	// a synthetic run targeting the predecessor) can reconstruct its plan.
	const manifest_for = new Map<string, VersionSetManifest>([
		["vs_v1", default_manifest],
		["vs_v0", default_manifest],
	]);
	const previous_for = new Map<string, string>([["vs_v1", "vs_v0"]]);

	const namespace = new InMemoryDurableObjectNamespace<{ deps: RunDeps }>({ deps }, (ctx, env) => {
		const h = make_run_handler(ctx as DoCtx, { deps: env.deps });
		return { fetch: h.handle, alarm: h.fire_alarm };
	});

	const templates: TemplateResolver = { resolve: async (_pkg, _vs) => template };
	const manifests: ManifestProvider = { get: async id => manifest_for.get(id) ?? null };
	const lineage: LineageProvider = { previous: async (_pkg, vs) => previous_for.get(vs) ?? null };
	const do_router = {
		get(run_id: string) {
			const id = namespace.idFromName(run_id);
			const stub = namespace.get(id);
			return { fetch: (req: Request) => stub.fetch(req) };
		},
	};
	const routes_deps: RoutesDeps = { db, do_router, templates, manifests, lineage };
	const app = make_routes(() => routes_deps);

	return {
		db,
		deps,
		template,
		pkg,
		manifest_for,
		previous_for,
		app,
		namespace,
		fire_alarm: async run_id => {
			const stub = namespace.get(namespace.idFromName(run_id));
			await stub.manualFireAlarm();
		},
	};
};

export type Envelope<T> = { ok: boolean; value?: T; error?: unknown };

export const post_json = async <T = unknown>(app: ReturnType<typeof make_routes>, path: string, body: unknown): Promise<{ status: number; body: Envelope<T> }> => {
	const req = new Request(`http://run.local${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const res = await app.fetch(req);
	return { status: res.status, body: (await res.json()) as Envelope<T> };
};

export const get_json = async <T = unknown>(app: ReturnType<typeof make_routes>, path: string): Promise<{ status: number; body: Envelope<T> }> => {
	const req = new Request(`http://run.local${path}`, { method: "GET" });
	const res = await app.fetch(req);
	return { status: res.status, body: (await res.json()) as Envelope<T> };
};

export const approve = async (app: ReturnType<typeof make_routes>, run_id: string, stage_name: string, decision: ApprovalDecision, user_id = "user_test", reason?: string) =>
	post_json(app, `/runs/${run_id}/approve`, { stage_name, decision, user_id, reason });
