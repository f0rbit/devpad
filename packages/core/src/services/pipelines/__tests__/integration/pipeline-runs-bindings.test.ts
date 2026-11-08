/**
 * Integration tests for orchestrated binding preservation (#160).
 *
 * Covers the three behaviours the issue pins down:
 *
 * 1. A promotion over an active version preserves every package-owned
 *    binding (D1 / R2 / Queue / Workers AI / plain_text vars / unknown
 *    types), replaces platform bindings by name (never duplicates), and
 *    sends `secret_text` via `keep_bindings` instead of re-sending it.
 * 2. A missing script fails the run with `script_not_found` — recorded
 *    as a `deploy_failed` stage event, on the run row's `error` column,
 *    with nothing uploaded and the run never advancing further.
 * 3. Any other `deploy_stage` error (upload 500) drives the run to
 *    `failed` with the reason recorded — no run can stay `deploying`
 *    with no error.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type PipelineTemplate } from "@devpad/pipeline-templates";
import type { Database } from "@devpad/schema/database/types";
import type { AdvanceError } from "../../runs.js";
import type { ResolvedPlan } from "../../state-machine.js";
import { advance_run, approve_stage, create_run } from "../../runs.js";
import {
	type TestDeps,
	create_test_db,
	make_deps,
	pipeline_stage_event_rows,
	script_name_for,
	seed_package,
	seed_user,
} from "./helpers.js";

const manifest = {
	package: "test-pkg",
	git_sha: "abc",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: { artifact_ref: "r2://x", size_bytes: 100, compatibility_date: "2025-01-01" },
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env",
	infra_plan_ref: "r2://infra",
} as const;

/** Package-owned bindings a real alchemy `infra.ts` declares (issue #160 live incident). */
const package_bindings = (): Array<Record<string, unknown>> => [
	{ type: "d1", name: "DB", id: "d1_live" },
	{ type: "r2_bucket", name: "CORPUS_BUCKET", bucket_name: "live-bucket" },
	{ type: "queue", name: "FETCH_QUEUE", queue_name: "live-queue" },
	{ type: "ai", name: "AI" },
	{ type: "plain_text", name: "AI_GATEWAY_ID", text: "gw-123" },
	{ type: "plain_text", name: "EXTRACTION_MODEL", text: "claude-haiku-5-5" },
	{ type: "plain_text", name: "ENVIRONMENT", text: "live" },
	{ type: "secret_text", name: "SECRET_TOKEN" },
	{ type: "some_unmodeled_type", name: "WEIRD", extra: { nested: true } },
];

/**
 * Package + plan plumbing for the binding tests. Carries what each
 * helper call needs; the run is created per test via
 * {@link createRunWithPlan} on top of a pre-seeded staging script.
 */
type RunSetup = {
	db: Database;
	deps: TestDeps;
	template: PipelineTemplate;
	pkg_id: string;
};

const createRunWithPlan = async (
	setup: RunSetup,
	version_set_id: string,
): Promise<{ run_id: string; plan: ResolvedPlan }> => {
	const created = await create_run(setup.deps.db, {
		package_id: setup.pkg_id,
		template: setup.template,
		manifest: manifest as never,
		version_set_id,
		previous_version_set_id: "vs_v0",
	});
	if (!created.ok) throw new Error("create_run failed");
	return { run_id: created.value.run.id, plan: created.value.plan };
};

const uploaded_version = async (deps: TestDeps, script: string) => {
	const versions = await deps.cf.versions.list(script);
	if (!versions.ok) throw new Error(`versions list failed for ${script}`);
	const uploaded = versions.value.filter((v) => v.annotations?.["workers/tag"] === "vs_v1");
	if (uploaded.length !== 1)
		throw new Error(`expected exactly one vs_v1 upload on ${script}, got ${String(uploaded.length)}`);
	return uploaded[0];
};

describe("pipeline runs — binding preservation (#160)", () => {
	let db: Database;
	let deps: TestDeps;
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
		deps.bundles.bindings = [
			{ type: "service", name: "ANTHROPIC", service: "anthropic" },
			{ type: "service", name: "PULSE", service: "pulse-api" },
		];

		// Staging script: exists (created by the package's own infra) with
		// its own bindings but no active deployment — the fallback read
		// path inherits from the latest version.
		const staging_seed = await deps.cf.versions.upload({
			kind: "single_file",
			script_name: script_name_for({ stage_name: "staging" }),
			annotations: { "workers/tag": "seed-staging" },
			bindings: [...package_bindings(), { type: "d1", name: "STAGING_DB", id: "d1_staging" }],
			vars: [{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "stale-vs" }],
		});
		if (!staging_seed.ok) throw new Error("staging seed failed");

		// Production script: active deployment over a version carrying the
		// full live binding set, with the platform bindings showing the
		// stale shape the merge must replace.
		const seed = await deps.cf.versions.upload({
			kind: "single_file",
			script_name: script_name_for(),
			annotations: { "workers/tag": "vs_v0" },
			bindings: [
				...package_bindings(),
				{ type: "service", name: "ANTHROPIC", service: "vault-stale" },
				{ type: "service", name: "PULSE", service: "pulse-stale" },
				{ type: "plain_text", name: "CALLER_VERSION_SET_ID", text: "stale-vs" },
			],
		});
		if (!seed.ok) throw new Error("seed upload failed");
		const deployment = await deps.cf.deployments.create({
			script_name: script_name_for(),
			strategy: { strategy: "percentage", versions: [{ version_id: seed.value.id, percentage: 100 }] },
		});
		if (!deployment.ok) throw new Error("initial deployment failed");
	});

	const createdRun = (version_set_id: string) => createRunWithPlan({ db, deps, template, pkg_id }, version_set_id);

	test("promotion preserves package bindings, replaces platform bindings, keeps secrets", async () => {
		const created = await createdRun("vs_v1");
		const started = await advance_run(deps, created.run_id, { kind: "start" }, created.plan);
		expect(started.ok).toBe(true);
		const approved = await approve_stage(
			deps,
			{ run_id: created.run_id, stage_name: "onebox", decision: "approved", user_id: "user_test" },
			created.plan,
		);
		expect(approved.ok).toBe(true);

		const uploaded = await uploaded_version(deps, script_name_for());
		expect(uploaded.keep_bindings).toEqual(["secret_text"]);
		const bindings = uploaded.bindings ?? [];
		const by_name = new Map(bindings.map((b) => [b.name, b]));

		// Package-owned bindings survive verbatim (including unknown types).
		for (const name of [
			"DB",
			"CORPUS_BUCKET",
			"FETCH_QUEUE",
			"AI",
			"AI_GATEWAY_ID",
			"EXTRACTION_MODEL",
			"ENVIRONMENT",
			"WEIRD",
		]) {
			expect(by_name.has(name)).toBe(true);
		}
		expect(by_name.get("DB")).toEqual({ type: "d1", name: "DB", id: "d1_live" });
		expect(by_name.get("WEIRD")).toEqual({ type: "some_unmodeled_type", name: "WEIRD", extra: { nested: true } });

		// Platform bindings replaced with the fresh set — never duplicated.
		expect(by_name.get("ANTHROPIC")).toEqual({ type: "service", name: "ANTHROPIC", service: "anthropic" });
		expect(by_name.get("PULSE")).toEqual({ type: "service", name: "PULSE", service: "pulse-api" });
		expect(bindings.filter((b) => b.name === "ANTHROPIC")).toHaveLength(1);
		expect(bindings.filter((b) => b.name === "PULSE")).toHaveLength(1);

		// Identity trio updated to this run's version-set, not duplicated.
		expect(by_name.get("CALLER_VERSION_SET_ID")).toEqual({
			type: "plain_text",
			name: "CALLER_VERSION_SET_ID",
			text: "vs_v1",
		});
		expect(bindings.filter((b) => b.name === "CALLER_VERSION_SET_ID")).toHaveLength(1);
		expect(by_name.get("CALLER_ENV")).toEqual({ type: "plain_text", name: "CALLER_ENV", text: "production" });

		// Secrets never re-sent explicitly.
		expect(by_name.has("SECRET_TOKEN")).toBe(false);

		// Staging stage inherited its own script's bindings via the
		// latest-version fallback (no active deployment on staging).
		const staging_uploaded = await uploaded_version(deps, script_name_for({ stage_name: "staging" }));
		const staging_bindings = staging_uploaded.bindings ?? [];
		const staging_names = new Set(staging_bindings.map((b) => b.name));
		expect(staging_names.has("STAGING_DB")).toBe(true);
		expect(staging_names.has("DB")).toBe(true);
		const staging_caller = staging_bindings.filter((b) => b.name === "CALLER_ENV");
		if (staging_caller.length !== 1) throw new Error("expected exactly one CALLER_ENV on the staging upload");
		expect(staging_caller[0].text).toBe("staging");
	});

	test("an upload failure (CF 500) drives the run to failed with the reason recorded", async () => {
		deps.cf.declare_upload_failure("cf api 500: version upload exploded");
		const created = await createdRun("vs_v1");

		const started = await advance_run(deps, created.run_id, { kind: "start" }, created.plan);
		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect((started.error as AdvanceError & { code?: string }).code).toBe("internal");

		const run_row = await db.query.pipeline_run.findFirst({
			where: (t, { eq: matches }) => matches(t.id, created.run_id),
		});
		if (!run_row) throw new Error("run row missing");
		expect(run_row.status).toBe("failed");
		expect(run_row.error).toContain("internal: cf api 500: version upload exploded");

		const failures = await pipeline_stage_event_rows(db, created.run_id);
		const deploy_failed_event = failures.filter((r) => r.kind === "deploy_failed").at(0);
		if (!deploy_failed_event) throw new Error("no deploy_failed event recorded");
		const payload = deploy_failed_event.payload as { kind?: string; error?: string };
		expect(payload.kind).toBe("deploy_failed");
		expect(payload.error).toContain("internal: cf api 500: version upload exploded");

		// The failed upload never landed and no deploy ever completed.
		const staging_versions = await deps.cf.versions.list(script_name_for({ stage_name: "staging" }));
		if (!staging_versions.ok) throw new Error("staging list failed");
		expect(staging_versions.value.filter((v) => v.annotations?.["workers/tag"] === "vs_v1")).toHaveLength(0);
		expect(failures.filter((r) => r.kind === "deploy_completed")).toHaveLength(0);
	});
});

describe("pipeline runs — missing script fails the run (#160)", () => {
	let db: Database;
	let deps: TestDeps;
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

		// Only the STAGING script exists — the production script
		// (`${name}`) was never created by the package's own infra.
		const staging_seed = await deps.cf.versions.upload({
			kind: "single_file",
			script_name: script_name_for({ stage_name: "staging" }),
			annotations: { "workers/tag": "seed-staging" },
			bindings: [{ type: "d1", name: "STAGING_DB", id: "d1_staging" }],
		});
		if (!staging_seed.ok) throw new Error("staging seed failed");
	});

	test("missing production script → run failed with script_not_found on a deploy_failed event", async () => {
		const created = await createRunWithPlan({ db, deps, template, pkg_id }, "vs_v1");
		const started = await advance_run(deps, created.run_id, { kind: "start" }, created.plan);
		expect(started.ok).toBe(true);

		const approved = await approve_stage(
			deps,
			{ run_id: created.run_id, stage_name: "onebox", decision: "approved", user_id: "user_test" },
			created.plan,
		);
		expect(approved.ok).toBe(false);
		if (approved.ok) return;
		expect((approved.error as AdvanceError & { code?: string }).code).toBe("script_not_found");

		const run_row = await db.query.pipeline_run.findFirst({
			where: (t, { eq: matches }) => matches(t.id, created.run_id),
		});
		if (!run_row) throw new Error("run row missing");
		expect(run_row.status).toBe("failed");
		expect(run_row.error).toContain("script_not_found");
		expect(run_row.finished_at).not.toBeNull();

		const rows = await pipeline_stage_event_rows(db, created.run_id);
		const deploy_failed_event = rows.filter((r) => r.kind === "deploy_failed").at(0);
		if (!deploy_failed_event) throw new Error("no deploy_failed event recorded");
		const payload = deploy_failed_event.payload as { kind?: string; error?: string };
		expect(payload.kind).toBe("deploy_failed");
		expect(payload.error).toContain("script_not_found");

		// Nothing was uploaded to the missing script (it still does not
		// exist), and no deploy ever completed for the run.
		const missing = await deps.cf.versions.list(script_name_for());
		if (missing.ok) throw new Error("missing script unexpectedly exists");
		expect(missing.error.code).toBe("not_found");
		expect(rows.filter((r) => r.kind === "deploy_completed" && r.stage_name !== "staging")).toHaveLength(0);
	});
});
