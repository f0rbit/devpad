import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_run } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { advance_run, approve_stage, create_run, request_rollback, tick_bake_complete } from "../../runs.js";
import { create_test_db, make_deps, script_name_for, seed_package, seed_user } from "./helpers.js";

const manifest: VersionSetManifest = {
	package: "rollback-pkg",
	git_sha: "abc",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: { artifact_ref: "r2://x", size_bytes: 100, compatibility_date: "2025-01-01" },
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env",
	infra_plan_ref: "r2://infra",
};

describe("pipeline runs — rollback", () => {
	let db: Database;
	let deps: ReturnType<typeof make_deps>;
	let template: PipelineTemplate;
	let pkg_id: string;
	let v0_version_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const p = await seed_package(db, u.id);
		pkg_id = p.id;
		const built = extendTemplate({});
		if (!built.ok) throw new Error("template build failed");
		template = built.value;
		deps = make_deps(db);

		// Pre-seed a v0 version + deployment so we have something to roll back to.
		const script = script_name_for(pkg_id);
		const v0 = await deps.cf.versions.upload({ script_name: script, annotations: { version_set_id: "vs_v0" } });
		if (!v0.ok) throw new Error("v0 upload failed");
		v0_version_id = v0.value.id;
		await deps.cf.deployments.create({
			script_name: script,
			strategy: { strategy: "percentage", versions: [{ version_id: v0.value.id, percentage: 100 }] },
		});
	});

	test("rollback during baking redeploys v0 at 100% via deployments.create", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		// Drive to baking after the first manual approval.
		await advance_run(deps, run.id, { kind: "start" }, plan);
		await approve_stage(deps, { run_id: run.id, stage_name: "onebox", decision: "approved", user_id: "user_test" }, plan);

		const after_approve = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
		expect(after_approve.status).toBe("baking");

		// Trigger rollback.
		const rollback_result = await request_rollback(deps, run.id, plan);
		expect(rollback_result.ok).toBe(true);
		if (!rollback_result.ok) return;
		// State machine emits needs_rollback → deploy_complete → done.
		expect(rollback_result.value.kind).toBe("done");

		const final = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
		expect(final.status).toBe("rolled_back");
		expect(final.finished_at).not.toBeNull();

		// Verify the LAST deployment is at 100% pointing to v0.
		const script = script_name_for(pkg_id);
		const list = await deps.cf.deployments.list(script);
		if (!list.ok) throw new Error("list failed");
		const last = list.value[list.value.length - 1];
		expect(last.strategy.strategy).toBe("percentage");
		expect(last.strategy.versions).toHaveLength(1);
		expect(last.strategy.versions[0].percentage).toBe(100);
		expect(last.strategy.versions[0].version_id).toBe(v0_version_id);
	});

	test("rollback request without a previous version set fails", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: null,
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);

		const result = await request_rollback(deps, run.id, plan);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const err_code = (result.error as { code?: string }).code;
			expect(err_code).toBe("no_previous_version");
		}
	});
});
