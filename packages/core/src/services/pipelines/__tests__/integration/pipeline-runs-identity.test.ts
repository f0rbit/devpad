/**
 * @module pipelines/__tests__/integration/pipeline-runs-identity
 *
 * Integration coverage for Task 5.C — every Worker version uploaded as
 * part of a pipeline run carries the `CALLER_PACKAGE`,
 * `CALLER_ENV`, `CALLER_VERSION_SET_ID` trio so vault can
 * identify the caller and stop returning `identity_missing`.
 *
 * Drives the same `advance_run` / `approve_stage` / `tick_bake_complete`
 * helpers used by the gradual + atomic + rollback test files, then
 * reaches into the in-memory CF provider to read back the recorded vars.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { advance_run, approve_stage, create_run, request_rollback, tick_bake_complete } from "../../runs.js";
import { resolve_script_name } from "../../script-name.js";
import { create_test_db, make_deps, seed_package, seed_user } from "./helpers.js";

const PACKAGE_NAME = "anthropic-search";

const manifest_for = (vs_id: string): VersionSetManifest => ({
	package: PACKAGE_NAME,
	git_sha: `sha_${vs_id}`,
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: {
			artifact_ref: `r2://worker/${vs_id}`,
			size_bytes: 1024,
			compatibility_date: "2025-01-01",
		},
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: `r2://env/${vs_id}`,
	infra_plan_ref: `r2://infra/${vs_id}`,
});

const trio_for = (env: "staging" | "production", vs_id: string) => ({
	CALLER_PACKAGE: PACKAGE_NAME,
	CALLER_ENV: env,
	CALLER_VERSION_SET_ID: vs_id,
});

const collect_vars = (vars: { name: string; text: string }[] | undefined): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const v of vars ?? []) out[v.name] = v.text;
	return out;
};

describe("pipeline runs — caller-identity injection", () => {
	let db: Database;
	let deps: ReturnType<typeof make_deps>;
	let template: PipelineTemplate;
	let pkg_id: string;

	const staging_script = () => resolve_script_name({ package: { name: PACKAGE_NAME, script_name_overrides: null }, stage_name: "staging" });
	const prod_script = () => resolve_script_name({ package: { name: PACKAGE_NAME, script_name_overrides: null }, stage_name: "full" });

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const p = await seed_package(db, u.id, { name: PACKAGE_NAME });
		pkg_id = p.id;
		const built = extendTemplate({});
		if (!built.ok) throw new Error("template build failed");
		template = built.value;
		deps = make_deps(db);

		// Pre-seed a previous deployment on the prod script so partial-traffic
		// stages have a predecessor. The seeded version carries its own
		// (different) identity trio so we can tell it apart from the run's
		// uploads.
		const seed = await deps.cf.versions.upload({
			script_name: prod_script(),
			annotations: { "workers/tag": "vs_v0" },
			vars: [
				{ type: "plain_text", name: "CALLER_PACKAGE", text: PACKAGE_NAME },
				{ type: "plain_text", name: "CALLER_ENV", text: "production" },
				{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "vs_v0" },
			],
		});
		if (!seed.ok) throw new Error("seed upload failed");
		await deps.cf.deployments.create({
			script_name: prod_script(),
			strategy: { strategy: "percentage", versions: [{ version_id: seed.value.id, percentage: 100 }] },
		});
	});

	test("gradual run uploads exactly one production version carrying the trio", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: manifest_for("vs_v1"),
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

		// Staging script — one version, staging trio.
		const staging_versions = await deps.cf.versions.list(staging_script());
		expect(staging_versions.ok).toBe(true);
		if (!staging_versions.ok) return;
		const staging_uploads = staging_versions.value;
		expect(staging_uploads).toHaveLength(1);
		expect(collect_vars(staging_uploads[0].vars)).toEqual(trio_for("staging", "vs_v1"));

		// Prod script — pre-seed (vs_v0) + one upload for vs_v1 (idempotent
		// across onebox/wave1/wave2/full).
		const prod_versions = await deps.cf.versions.list(prod_script());
		expect(prod_versions.ok).toBe(true);
		if (!prod_versions.ok) return;
		const new_prod = prod_versions.value.filter(v => v.annotations?.["workers/tag"] === "vs_v1");
		expect(new_prod).toHaveLength(1);
		expect(collect_vars(new_prod[0].vars)).toEqual(trio_for("production", "vs_v1"));

		// Fake-level assertion — every version on the prod script must carry
		// CALLER_PACKAGE. (vs_v0 from the seed + vs_v1 from this run.)
		deps.cf.assertVersionHasVars(prod_script(), { CALLER_PACKAGE: PACKAGE_NAME });
	});

	test("atomic run uploads both staging and prod versions with the right environment", async () => {
		const atomic = extendTemplate({ rollout: { type: "atomic" } });
		if (!atomic.ok) throw new Error("atomic template build failed");

		const created = await create_run(db, {
			package_id: pkg_id,
			template: atomic.value,
			manifest: manifest_for("vs_v2"),
			version_set_id: "vs_v2",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);
		await approve_stage(deps, { run_id: run.id, stage_name: "atomic-prod", decision: "approved", user_id: "user_test" }, plan);

		const staging = await deps.cf.versions.list(staging_script());
		if (!staging.ok) throw new Error("staging list failed");
		const staging_new = staging.value.filter(v => v.annotations?.["workers/tag"] === "vs_v2");
		expect(staging_new).toHaveLength(1);
		expect(collect_vars(staging_new[0].vars)).toEqual(trio_for("staging", "vs_v2"));

		const prod = await deps.cf.versions.list(prod_script());
		if (!prod.ok) throw new Error("prod list failed");
		const prod_new = prod.value.filter(v => v.annotations?.["workers/tag"] === "vs_v2");
		expect(prod_new).toHaveLength(1);
		expect(collect_vars(prod_new[0].vars)).toEqual(trio_for("production", "vs_v2"));
	});

	test("rollback reuses the existing version_id and does not re-upload", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: manifest_for("vs_v1"),
			version_set_id: "vs_v1",
			previous_version_set_id: "vs_v0",
		});
		if (!created.ok) throw new Error("create_run failed");
		const { run, plan } = created.value;

		await advance_run(deps, run.id, { kind: "start" }, plan);
		await approve_stage(deps, { run_id: run.id, stage_name: "onebox", decision: "approved", user_id: "user_test" }, plan);
		await tick_bake_complete(deps, run.id, plan);

		const before_rollback = await deps.cf.versions.list(prod_script());
		if (!before_rollback.ok) throw new Error("list failed");
		const prod_version_count_before = before_rollback.value.length;

		const rollback_result = await request_rollback(deps, run.id, plan);
		expect(rollback_result.ok).toBe(true);

		const after_rollback = await deps.cf.versions.list(prod_script());
		if (!after_rollback.ok) throw new Error("list failed");
		// No new version was uploaded — rollback re-deploys an existing one.
		expect(after_rollback.value).toHaveLength(prod_version_count_before);

		// The vs_v0 version it rolled back to still carries its identity trio.
		const v0 = after_rollback.value.find(v => v.annotations?.["workers/tag"] === "vs_v0");
		expect(v0).toBeDefined();
		expect(collect_vars(v0!.vars)).toEqual(trio_for("production", "vs_v0"));
	});

	test("re-running with the same version_set_id reuses the existing version (no duplicate trio uploaded)", async () => {
		const created = await create_run(db, {
			package_id: pkg_id,
			template,
			manifest: manifest_for("vs_v1"),
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

		const prod_after_run = await deps.cf.versions.list(prod_script());
		if (!prod_after_run.ok) throw new Error("list failed");
		const vs_v1_versions = prod_after_run.value.filter(v => v.annotations?.["workers/tag"] === "vs_v1");
		// Exactly one prod upload across all gradual stages because deploy_stage
		// is idempotent on (script_name, version_set_id).
		expect(vs_v1_versions).toHaveLength(1);
	});
});
