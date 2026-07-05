import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { advance_run, approve_stage, create_run } from "../../runs.js";
import { create_test_db, make_deps, seed_package, seed_user } from "./helpers.js";

const manifest_with_do_migrations: VersionSetManifest = {
	package: "forced-atomic-pkg",
	git_sha: "abc",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: { artifact_ref: "r2://x", size_bytes: 100, compatibility_date: "2025-01-01" },
	},
	migrations: {
		do_migrations: [{ class_name: "Counter", tag: "v2", kind: "new_sqlite_classes" }],
	},
	env_manifest_ref: "r2://env",
	infra_plan_ref: "r2://infra",
};

const manifest_assets_no_affinity: VersionSetManifest = {
	package: "no-affinity-pkg",
	git_sha: "abc",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: { artifact_ref: "r2://x", size_bytes: 100, compatibility_date: "2025-01-01" },
		assets: { artifact_ref: "r2://assets", version_affinity: "none" },
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env",
	infra_plan_ref: "r2://infra",
};

describe("pipeline runs — forced atomic", () => {
	let db: Database;
	let deps: ReturnType<typeof make_deps>;
	let template: PipelineTemplate;
	let pkg_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const p = await seed_package(db, u.id);
		pkg_id = p.id;
		const built = extendTemplate({}); // declared gradual
		if (!built.ok) throw new Error("template build failed");
		template = built.value;
		deps = make_deps(db);
	});

	test("DO migrations force atomic, persist forced_atomic_reason, emit warning event", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: manifest_with_do_migrations,
			version_set_id: "vs_v1",
			previous_version_set_id: null,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const { run, plan } = created.value;

		expect(plan.forced_reason).toBe("do_migrations");
		expect(plan.stages.map((s) => s.name)).toEqual(["staging", "atomic-prod"]);

		const row = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
		expect(row.shape).toBe("atomic");
		expect(row.forced_atomic_reason).toBe("do_migrations");

		const warnings = await db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run.id));
		const warning = warnings.find((w) => w.kind === "warning");
		expect(warning).toBeDefined();
		expect((warning?.payload as { reason: string } | null)?.reason).toBe("do_migrations");

		// Run completes via the atomic path.
		const start = await advance_run(deps, run.id, { kind: "start" }, plan);
		if (!start.ok) throw new Error(`start failed: ${JSON.stringify(start.error)}`);
		const approve = await approve_stage(
			deps,
			{ run_id: run.id, stage_name: "atomic-prod", decision: "approved", user_id: "user_test" },
			plan,
		);
		if (!approve.ok) throw new Error(`approve failed: ${JSON.stringify(approve.error)}`);
		const final = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
		expect(final.status).toBe("completed");
	});

	test("assets with version_affinity=none force atomic with reason asset_affinity_none", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: manifest_assets_no_affinity,
			version_set_id: "vs_v1",
			previous_version_set_id: null,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const { run, plan } = created.value;
		expect(plan.forced_reason).toBe("asset_affinity_none");
		const row = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
		expect(row.forced_atomic_reason).toBe("asset_affinity_none");
	});
});
