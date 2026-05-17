import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_run } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { advance_run, approve_stage, create_run } from "../../runs.js";
import { create_test_db, make_deps, script_name_for, seed_package, seed_user } from "./helpers.js";

const manifest: VersionSetManifest = {
	package: "atomic-pkg",
	git_sha: "abc",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: { artifact_ref: "r2://x", size_bytes: 100, compatibility_date: "2025-01-01" },
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env",
	infra_plan_ref: "r2://infra",
};

describe("pipeline runs — user-declared atomic", () => {
	let db: Database;
	let deps: ReturnType<typeof make_deps>;
	let template: PipelineTemplate;
	let pkg_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const p = await seed_package(db, u.id);
		pkg_id = p.id;
		const built = extendTemplate({ rollout: { type: "atomic" } });
		if (!built.ok) throw new Error("template build failed");
		template = built.value;
		deps = make_deps(db);
	});

	test("declared atomic produces shape='atomic' and exactly two deploys (staging + atomic-prod at 100%)", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: null,
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const { run, plan } = created.value;

		expect(plan.forced_reason).toBeNull();
		expect(plan.stages.map(s => s.name)).toEqual(["staging", "atomic-prod"]);
		expect((await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!.shape).toBe("atomic");

		await advance_run(deps, run.id, { kind: "start" }, plan);

		const approved = await approve_stage(deps, { run_id: run.id, stage_name: "atomic-prod", decision: "approved", user_id: "user_test" }, plan);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		// After Pass: deploys atomic-prod → bake = null → completes immediately
		expect(approved.value.kind).toBe("done");

		const final = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
		expect(final.status).toBe("completed");
		expect(final.current_stage).toBe("atomic-prod");

		// staging on `${name}-staging`, atomic-prod on `${name}`.
		const staging_list = await deps.cf.deployments.list(script_name_for({ stage_name: "staging" }));
		if (!staging_list.ok) throw new Error("staging list failed");
		expect(staging_list.value).toHaveLength(1);

		const main_list = await deps.cf.deployments.list(script_name_for());
		if (!main_list.ok) throw new Error("main list failed");
		expect(main_list.value).toHaveLength(1); // atomic-prod
		// atomic-prod always at 100% single-version
		expect(main_list.value[0].strategy.versions).toHaveLength(1);
		expect(main_list.value[0].strategy.versions[0].percentage).toBe(100);
	});
});
