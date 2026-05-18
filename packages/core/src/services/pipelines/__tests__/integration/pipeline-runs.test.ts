import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import { pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { advance_run, approve_stage, create_run, tick_bake_complete } from "../../runs.js";
import { create_test_db, make_deps, script_name_for, seed_package, seed_user } from "./helpers.js";

const default_manifest: VersionSetManifest = {
	package: "test-pkg",
	git_sha: "abc123",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: {
			artifact_ref: "r2://worker/v1",
			size_bytes: 1024,
			compatibility_date: "2025-01-01",
		},
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env/v1",
	infra_plan_ref: "r2://infra/v1",
};

const events_for = async (db: Database, run_id: string) => {
	return db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id));
};

const run_status = async (db: Database, run_id: string) => {
	const rows = await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id));
	return rows[0]!;
};

describe("pipeline runs — full gradual happy path", () => {
	let db: Database;
	let deps: ReturnType<typeof make_deps>;
	let template: PipelineTemplate;
	let pkg_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const p = await seed_package(db, u.id);
		pkg_id = p.id;

		const built = extendTemplate({});
		if (!built.ok) throw new Error("template build failed");
		template = built.value;

		deps = make_deps(db);

		// Pre-seed a previous deployment so partial-traffic stages have a
		// predecessor to ramp down. Without this, the deploy bootstraps
		// to 100% and the percentage assertions become meaningless. Seed
		// on the non-staging script — that's where onebox/wave1/wave2/full
		// land. The staging stage deploys to its own `${name}-staging` script.
		const main_script = script_name_for();
		const seed_version = await deps.cf.versions.upload({ kind: "single_file", script_name: main_script, annotations: { "workers/tag": "vs_v0" } });
		if (!seed_version.ok) throw new Error("seed upload failed");
		await deps.cf.deployments.create({
			script_name: main_script,
			strategy: {
				strategy: "percentage",
				versions: [{ version_id: seed_version.value.id, percentage: 100 }],
			},
		});
	});

	test("4 stages deploy in order with correct percentages, manual approval at staging→onebox", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: default_manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;
		const { run, plan } = created.value;

		// start → deploys staging → asks for manual approval at staging→onebox
		const r1 = await advance_run(deps, run.id, { kind: "start" }, plan);
		expect(r1.ok).toBe(true);
		if (!r1.ok) return;
		expect(r1.value.kind).toBe("done");

		const after_start = await run_status(db, run.id);
		expect(after_start.status).toBe("awaiting_approval");
		expect(after_start.current_stage).toBe("staging");

		// Approve staging→onebox manually
		const approved = await approve_stage(deps, { run_id: run.id, stage_name: "onebox", decision: "approved", user_id: "user_test" }, plan);
		expect(approved.ok).toBe(true);
		if (!approved.ok) return;
		// After Pass: deploys onebox at 1% → bake schedule
		expect(approved.value.kind).toBe("needs_bake_schedule");

		const after_approve = await run_status(db, run.id);
		expect(after_approve.status).toBe("baking");
		expect(after_approve.current_stage).toBe("onebox");

		// tick bake → auto gate → deploys wave1 → bake
		const r2 = await tick_bake_complete(deps, run.id, plan);
		expect(r2.ok).toBe(true);
		if (!r2.ok) return;
		expect(r2.value.kind).toBe("needs_bake_schedule");
		expect((await run_status(db, run.id)).current_stage).toBe("wave1");

		const r3 = await tick_bake_complete(deps, run.id, plan);
		expect(r3.ok).toBe(true);
		if (!r3.ok) return;
		expect(r3.value.kind).toBe("needs_bake_schedule");
		expect((await run_status(db, run.id)).current_stage).toBe("wave2");

		const r4 = await tick_bake_complete(deps, run.id, plan);
		expect(r4.ok).toBe(true);
		if (!r4.ok) return;
		// wave2→full has 0 bake, so should not return needs_bake_schedule — full deploys and completes
		expect(r4.value.kind).toBe("done");

		const final = await run_status(db, run.id);
		expect(final.status).toBe("completed");
		expect(final.current_stage).toBe("full");
		expect(final.finished_at).not.toBeNull();
	});

	test("deployments land at 1, 10, 50, 100 percent for the new version", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: default_manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);
		await approve_stage(deps, { run_id: run.id, stage_name: "onebox", decision: "approved", user_id: "user_test" }, plan);
		await tick_bake_complete(deps, run.id, plan);
		await tick_bake_complete(deps, run.id, plan);
		await tick_bake_complete(deps, run.id, plan);

		// After 5.B, staging lands on `${name}-staging` and onebox/wave1/wave2/full
		// land on `${name}`. So the staging deploy lives on a different script.
		const staging_script = script_name_for({ stage_name: "staging" });
		const main_script = script_name_for();

		const staging_list = await deps.cf.deployments.list(staging_script);
		if (!staging_list.ok) throw new Error("staging list failed");
		// One staging deploy at 100% single-version (env-routed elsewhere).
		expect(staging_list.value).toHaveLength(1);
		expect(staging_list.value[0].strategy.versions[0].percentage).toBe(100);

		const main_list = await deps.cf.deployments.list(main_script);
		if (!main_list.ok) throw new Error("main list failed");
		// pre-seed + onebox + wave1 + wave2 + full = 5; slice off the pre-seed.
		const post_seed = main_list.value.slice(1);
		expect(post_seed.length).toBe(4);

		// onebox at 1%, with v0 at 99%
		expect(post_seed[0].strategy.versions).toHaveLength(2);
		const v1_id = post_seed[0].strategy.versions.find(v => v.percentage === 1)?.version_id;
		expect(v1_id).toBeDefined();
		expect(post_seed[0].strategy.versions.find(v => v.percentage === 99)).toBeDefined();

		// wave1 at 10%
		expect(post_seed[1].strategy.versions.find(v => v.percentage === 10)).toBeDefined();
		expect(post_seed[1].strategy.versions.find(v => v.percentage === 90)).toBeDefined();

		// wave2 at 50%
		expect(post_seed[2].strategy.versions.find(v => v.percentage === 50)).toBeDefined();

		// full at 100% (single-version)
		expect(post_seed[3].strategy.versions[0].percentage).toBe(100);

		// And percentages always sum to 100 — fake invariant
		deps.cf.assertPercentageSum();
	});

	test("records deploy + gate + bake events for every stage", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: default_manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);
		await approve_stage(deps, { run_id: run.id, stage_name: "onebox", decision: "approved", user_id: "user_test" }, plan);
		await tick_bake_complete(deps, run.id, plan);
		await tick_bake_complete(deps, run.id, plan);
		await tick_bake_complete(deps, run.id, plan);

		const events = await events_for(db, run.id);
		const kinds = events.map(e => e.kind);
		expect(kinds.filter(k => k === "deploy_started").length).toBe(5);
		expect(kinds.filter(k => k === "deploy_completed").length).toBe(5);
		expect(kinds.filter(k => k === "bake_started").length).toBe(3); // onebox/wave1/wave2 have positive bake
		expect(kinds.filter(k => k === "gate_verdict").length).toBeGreaterThanOrEqual(4); // 4 transitions
	});

	test("manual approval at staging→onebox emits a pulse pending event", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: default_manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);
		expect(deps.pulse.emitted.length).toBeGreaterThanOrEqual(1);
		expect(deps.pulse.emitted[0].event).toBe("gate_pending_manual");
	});

	test("denial fails the run", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: default_manifest,
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);
		const denied = await approve_stage(deps, { run_id: run.id, stage_name: "onebox", decision: "denied", user_id: "user_test", reason: "looks dodgy" }, plan);
		expect(denied.ok).toBe(true);

		const final = await run_status(db, run.id);
		expect(final.status).toBe("failed");
	});
});
