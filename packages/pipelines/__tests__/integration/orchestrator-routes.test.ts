import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate } from "@devpad/pipeline-templates";
import { pipeline_package, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import {
	approve,
	build_harness,
	type Envelope,
	get_json,
	post_json,
	SCRIPT_NAME_FOR,
	type TestHarness,
} from "./helpers";

const run_status_of = async (db: Database, run_id: string) =>
	(await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id)))[0]!;

const events_of = async (db: Database, run_id: string) =>
	db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id));

const expect_ok = <T>(body: Envelope<unknown>): T => {
	if (!body.ok) throw new Error(`expected ok envelope, got error: ${JSON.stringify(body.error)}`);
	return body.value as T;
};

describe("orchestrator routes — full gradual run via HTTP", () => {
	let h: TestHarness;

	beforeEach(async () => {
		h = await build_harness();
	});

	test("POST /runs returns run + initial state awaiting_approval at staging", async () => {
		const res = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		expect(res.status).toBe(200);
		const value = expect_ok<{ run_id: string; status: string }>(res.body);
		expect(value.run_id).toMatch(/^pipeline-run_/);

		// State machine reaches awaiting_approval after staging deploy.
		const row = await run_status_of(h.db, value.run_id);
		expect(row.status).toBe("awaiting_approval");
		expect(row.current_stage).toBe("staging");
	});

	test("GET /runs/:id reads from D1 (source of truth)", async () => {
		const res = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const value = expect_ok<{ run_id: string }>(res.body);

		const fetched = await get_json(h.app, `/runs/${value.run_id}`);
		expect(fetched.status).toBe(200);
		const row = expect_ok<{ id: string; status: string; current_stage: string }>(fetched.body);
		expect(row.id).toBe(value.run_id);
		expect(row.status).toBe("awaiting_approval");
	});

	test("approve → bake → tick alarm → completes gradual rollout", async () => {
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);

		// Manual approve staging→onebox
		const ap = await approve(h.app, run_id, "onebox", "approved");
		expect(ap.status).toBe(200);

		const after_approve = await run_status_of(h.db, run_id);
		expect(after_approve.status).toBe("baking");
		expect(after_approve.current_stage).toBe("onebox");

		// Fire bake alarms: onebox → wave1 → wave2 → full
		await h.fire_alarm(run_id);
		expect((await run_status_of(h.db, run_id)).current_stage).toBe("wave1");

		await h.fire_alarm(run_id);
		expect((await run_status_of(h.db, run_id)).current_stage).toBe("wave2");

		await h.fire_alarm(run_id);
		const final = await run_status_of(h.db, run_id);
		expect(final.status).toBe("completed");
		expect(final.current_stage).toBe("full");
		expect(final.finished_at).not.toBeNull();
	});

	test("4 stage deploy events recorded with correct percentages on the CF provider", async () => {
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);
		await approve(h.app, run_id, "onebox", "approved");
		await h.fire_alarm(run_id);
		await h.fire_alarm(run_id);
		await h.fire_alarm(run_id);

		// After 5.B, staging lands on `${name}-staging` and the rest on `${name}`.
		const staging_list = await h.deps.cf.deployments.list(SCRIPT_NAME_FOR({ stage_name: "staging" }));
		if (!staging_list.ok) throw new Error("staging list failed");
		expect(staging_list.value).toHaveLength(1); // staging

		const main_list = await h.deps.cf.deployments.list(SCRIPT_NAME_FOR());
		if (!main_list.ok) throw new Error("main list failed");
		const post_seed = main_list.value.slice(1);
		// onebox + wave1 + wave2 + full on main script
		expect(post_seed.length).toBe(4);
		expect(post_seed[0].strategy.versions.find((v) => v.percentage === 1)).toBeDefined();
		expect(post_seed[1].strategy.versions.find((v) => v.percentage === 10)).toBeDefined();
		expect(post_seed[2].strategy.versions.find((v) => v.percentage === 50)).toBeDefined();
		expect(post_seed[3].strategy.versions[0].percentage).toBe(100);
		h.deps.cf.assertPercentageSum();
	});
});

describe("orchestrator routes — atomic shape", () => {
	test("atomic template runs a single 100% deploy then waits for approval", async () => {
		const atomic_template = extendTemplate({ rollout: { type: "atomic" } });
		if (!atomic_template.ok) throw new Error("atomic template build failed");
		const h = await build_harness({ template: atomic_template.value });

		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);

		// Atomic rollout has stages: staging → atomic-prod. After staging
		// deploys, the run sits at awaiting_approval for the manual gate.
		const row = await run_status_of(h.db, run_id);
		expect(row.shape).toBe("atomic");
		expect(row.status).toBe("awaiting_approval");

		// Approve → deploys atomic-prod at 100% → completed
		const ap = await approve(h.app, run_id, "atomic-prod", "approved");
		expect(ap.status).toBe(200);

		const final = await run_status_of(h.db, run_id);
		expect(final.status).toBe("completed");
		expect(final.current_stage).toBe("atomic-prod");
	});
});

describe("orchestrator routes — cancel mid-run", () => {
	test("POST /runs/:id/cancel halts the run and records the cancel event", async () => {
		const h = await build_harness();
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);
		await approve(h.app, run_id, "onebox", "approved");
		expect((await run_status_of(h.db, run_id)).status).toBe("baking");

		const res = await post_json(h.app, `/runs/${run_id}/cancel`, {});
		expect(res.status).toBe(200);

		const final = await run_status_of(h.db, run_id);
		expect(final.status).toBe("cancelled");

		const events = await events_of(h.db, run_id);
		expect(events.some((e) => e.kind === "error" && JSON.stringify(e.payload).includes("cancel"))).toBe(true);
	});
});

describe("orchestrator routes — rollback", () => {
	test("POST /runs/:id/rollback on in-flight run cancels source, creates new rollback run that redeploys v0 at 100%", async () => {
		const h = await build_harness();
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);

		await approve(h.app, run_id, "onebox", "approved");
		expect((await run_status_of(h.db, run_id)).status).toBe("baking");

		const rb = await post_json<{ run_id: string; kind: string; target_version_set_id: string; source_run_id: string }>(
			h.app,
			`/runs/${run_id}/rollback`,
			{},
		);
		expect(rb.status).toBe(200);
		const rb_value = expect_ok<{ run_id: string; kind: string; target_version_set_id: string; source_run_id: string }>(
			rb.body,
		);
		expect(rb_value.run_id).not.toBe(run_id);
		expect(rb_value.kind).toBe("rollback");
		expect(rb_value.target_version_set_id).toBe("vs_v0");
		expect(rb_value.source_run_id).toBe(run_id);

		// Source run was cancelled (was in-flight); new rollback run completed.
		const source = await run_status_of(h.db, run_id);
		expect(source.status).toBe("cancelled");
		const rollback = await run_status_of(h.db, rb_value.run_id);
		expect(rollback.status).toBe("completed");
		expect(rollback.kind).toBe("rollback");
		expect(rollback.version_set_id).toBe("vs_v0");

		// Rollback redeploys on the non-staging (main) script at 100%.
		const list = await h.deps.cf.deployments.list(SCRIPT_NAME_FOR());
		if (!list.ok) throw new Error("list failed");
		const last = list.value[list.value.length - 1];
		expect(last.strategy.versions[0].percentage).toBe(100);
	});

	test("POST /runs/:id/rollback on terminal-state run creates a new rollback run without touching the source", async () => {
		const h = await build_harness();
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);

		// Drive the source run to a terminal state by cancelling it first.
		await post_json(h.app, `/runs/${run_id}/cancel`, {});
		const source_before = await run_status_of(h.db, run_id);
		expect(source_before.status).toBe("cancelled");

		const rb = await post_json<{ run_id: string; kind: string }>(h.app, `/runs/${run_id}/rollback`, {});
		expect(rb.status).toBe(200);
		const rb_value = expect_ok<{ run_id: string; kind: string }>(rb.body);
		expect(rb_value.run_id).not.toBe(run_id);
		expect(rb_value.kind).toBe("rollback");

		// Source unchanged, new rollback run completed.
		const source_after = await run_status_of(h.db, run_id);
		expect(source_after.status).toBe("cancelled");
		const rollback = await run_status_of(h.db, rb_value.run_id);
		expect(rollback.status).toBe("completed");
		expect(rollback.kind).toBe("rollback");
	});
});

describe("orchestrator routes — validation + errors", () => {
	test("POST /runs with invalid body returns 400", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/runs", { package_id: "" });
		expect(res.status).toBe(400);
		expect(res.body.ok).toBe(false);
	});

	test("POST /runs for unknown package returns 404", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/runs", {
			package_id: "pipeline-package_does_not_exist",
			version_set_id: "vs_v1",
		});
		expect(res.status).toBe(404);
	});

	test("POST /runs with unknown version_set returns 404", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_missing" });
		expect(res.status).toBe(404);
	});

	test("GET /runs/:id for unknown run returns 404", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, "/runs/pipeline-run_does_not_exist");
		expect(res.status).toBe(404);
	});

	test("POST /runs/:id/approve with invalid decision returns 400", async () => {
		const h = await build_harness();
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);
		const res = await post_json(h.app, `/runs/${run_id}/approve`, {
			stage_name: "onebox",
			decision: "maybe",
			user_id: "user_test",
		});
		expect(res.status).toBe(400);
	});

	test("POST /runs/:id/rollback without previous version returns 400 no_previous_version_set", async () => {
		const h = await build_harness();
		// Clear lineage so previous = null
		h.previous_for.delete("vs_v1");
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);
		const rb = await post_json<unknown>(h.app, `/runs/${run_id}/rollback`, {});
		expect(rb.status).toBe(400);
		expect(rb.body.ok).toBe(false);
		const error = rb.body.error as { code: string };
		expect(error.code).toBe("no_previous_version_set");
	});
});

describe("orchestrator routes — wire envelope contract (Phase 13.E1)", () => {
	test("error envelopes are flat: error has top-level `code`, never a nested `ok: false`", async () => {
		const h = await build_harness();
		const res = await post_json(h.app, "/runs", {
			package_id: "pipeline-package_does_not_exist",
			version_set_id: "vs_v1",
		});
		expect(res.status).toBe(404);
		expect(res.body.ok).toBe(false);
		const error = res.body.error as Record<string, unknown>;
		// Single wrap: `error` is the wire payload, not another envelope.
		expect(error).not.toHaveProperty("ok");
		expect(error).not.toHaveProperty("error");
		// Discriminator is `code`, never `kind`.
		expect(typeof error.code).toBe("string");
		expect(error.code).toBe("not_found");
		expect(error).not.toHaveProperty("kind");
	});

	test("service-Result errors (kind) are normalised to wire shape (code) at the route boundary", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, "/runs/pipeline-run_does_not_exist");
		expect(res.status).toBe(404);
		const error = res.body.error as Record<string, unknown>;
		// `get_run` returns `{ kind: "not_found", resource, id }` — boundary maps to `code`.
		expect(error.code).toBe("not_found");
		expect(error).not.toHaveProperty("kind");
		expect(error.resource).toBe("pipeline_run");
	});
});

describe("orchestrator routes — DO state surface", () => {
	test("GET /runs path on the DO surfaces the persisted plan + alarm", async () => {
		const h = await build_harness();
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);
		await approve(h.app, run_id, "onebox", "approved");

		// Hit the DO's debug `/state` directly via the namespace stub.
		const stub = h.namespace.get(h.namespace.idFromName(run_id));
		const res = await stub.fetch(new Request(`http://run.local/state`, { method: "GET" }));
		const body = (await res.json()) as Envelope<{ run_id: string; last_alarm_ms: number | null }>;
		expect(body.ok).toBe(true);
		expect(body.value!.run_id).toBe(run_id);
		expect(body.value!.last_alarm_ms).not.toBeNull();
	});
});

describe("orchestrator routes — GET /runs list", () => {
	test("returns runs ordered by created_at DESC", async () => {
		const h = await build_harness();

		// Create three runs back-to-back. SQLite's CURRENT_TIMESTAMP is
		// per-statement so a tight loop can collide; pre-seed distinct
		// created_at timestamps explicitly so the ordering assertion is
		// deterministic regardless of clock resolution.
		const r1 = expect_ok<{ run_id: string }>(
			(await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" })).body,
		);
		const r2 = expect_ok<{ run_id: string }>(
			(await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" })).body,
		);
		const r3 = expect_ok<{ run_id: string }>(
			(await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" })).body,
		);

		await h.db
			.update(pipeline_run)
			.set({ created_at: "2026-05-01T00:00:00.000Z" })
			.where(eq(pipeline_run.id, r1.run_id));
		await h.db
			.update(pipeline_run)
			.set({ created_at: "2026-05-02T00:00:00.000Z" })
			.where(eq(pipeline_run.id, r2.run_id));
		await h.db
			.update(pipeline_run)
			.set({ created_at: "2026-05-03T00:00:00.000Z" })
			.where(eq(pipeline_run.id, r3.run_id));

		const res = await get_json(h.app, "/runs");
		expect(res.status).toBe(200);
		const runs = expect_ok<Array<{ id: string }>>(res.body);
		expect(runs.length).toBe(3);
		expect(runs[0].id).toBe(r3.run_id);
		expect(runs[1].id).toBe(r2.run_id);
		expect(runs[2].id).toBe(r1.run_id);
	});

	test("filters by package_id", async () => {
		const h = await build_harness();
		await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });

		const res = await get_json(h.app, `/runs?package_id=${h.pkg.id}`);
		expect(res.status).toBe(200);
		const runs = expect_ok<Array<{ package_id: string }>>(res.body);
		expect(runs.length).toBeGreaterThan(0);
		runs.forEach((r) => expect(r.package_id).toBe(h.pkg.id));

		const other = await get_json(h.app, "/runs?package_id=pipeline-package_does_not_exist");
		expect(other.status).toBe(200);
		expect(expect_ok<unknown[]>(other.body)).toHaveLength(0);
	});

	test("filters by status", async () => {
		const h = await build_harness();
		const r = expect_ok<{ run_id: string }>(
			(await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" })).body,
		);

		// Run sits at awaiting_approval after creation.
		const awaiting = await get_json(h.app, "/runs?status=awaiting_approval");
		expect(awaiting.status).toBe(200);
		const awaiting_rows = expect_ok<Array<{ id: string }>>(awaiting.body);
		expect(awaiting_rows.some((row) => row.id === r.run_id)).toBe(true);

		const completed = await get_json(h.app, "/runs?status=completed");
		expect(completed.status).toBe(200);
		const completed_rows = expect_ok<Array<{ id: string }>>(completed.body);
		expect(completed_rows.some((row) => row.id === r.run_id)).toBe(false);
	});

	test("limit clamps to 200 and rejects invalid values", async () => {
		const h = await build_harness();
		await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });

		const ok_res = await get_json(h.app, "/runs?limit=1");
		expect(ok_res.status).toBe(200);
		const rows = expect_ok<unknown[]>(ok_res.body);
		expect(rows.length).toBe(1);

		const too_big = await get_json(h.app, "/runs?limit=999");
		expect(too_big.status).toBe(400);
		expect(too_big.body.ok).toBe(false);

		const not_a_number = await get_json(h.app, "/runs?limit=foo");
		expect(not_a_number.status).toBe(400);
	});

	test("invalid status returns 400", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, "/runs?status=not_a_status");
		expect(res.status).toBe(400);
		expect(res.body.ok).toBe(false);
	});

	test("empty result set returns empty array, status 200", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, "/runs");
		expect(res.status).toBe(200);
		const rows = expect_ok<unknown[]>(res.body);
		expect(rows).toEqual([]);
	});
});

describe("orchestrator routes — GET /packages", () => {
	test("returns all packages", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, "/packages");
		expect(res.status).toBe(200);
		const packages = expect_ok<Array<{ id: string; name: string; project_id: string | null }>>(res.body);
		expect(packages.length).toBe(1);
		expect(packages[0].id).toBe(h.pkg.id);
		expect(packages[0].name).toBe("test-pkg");
		expect(packages[0].project_id).toBeNull();
	});

	test("filters by project_id query param", async () => {
		const h = await build_harness();
		// Link the seeded package to a project id. The FK is nullable; the row
		// need not exist in `project` because bun:sqlite has FK enforcement off
		// by default (matches D1's behaviour for the read path under test).
		await h.db.update(pipeline_package).set({ project_id: "project_alpha" }).where(eq(pipeline_package.id, h.pkg.id));

		const alpha = await get_json(h.app, "/packages?project_id=project_alpha");
		expect(alpha.status).toBe(200);
		const alpha_rows = expect_ok<Array<{ id: string; project_id: string | null }>>(alpha.body);
		expect(alpha_rows.length).toBe(1);
		expect(alpha_rows[0].project_id).toBe("project_alpha");

		const beta = await get_json(h.app, "/packages?project_id=project_beta");
		expect(beta.status).toBe(200);
		expect(expect_ok<unknown[]>(beta.body)).toEqual([]);
	});

	test("GET /packages/:id returns the package", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, `/packages/${h.pkg.id}`);
		expect(res.status).toBe(200);
		const pkg = expect_ok<{ id: string; name: string }>(res.body);
		expect(pkg.id).toBe(h.pkg.id);
		expect(pkg.name).toBe("test-pkg");
	});

	test("GET /packages/:id returns 404 for unknown id", async () => {
		const h = await build_harness();
		const res = await get_json(h.app, "/packages/pipeline-package_does_not_exist");
		expect(res.status).toBe(404);
		expect(res.body.ok).toBe(false);
		const error = res.body.error as { code: string; resource: string; id: string };
		expect(error.code).toBe("not_found");
		expect(error.resource).toBe("pipeline_package");
		expect(error.id).toBe("pipeline-package_does_not_exist");
	});
});

describe("orchestrator routes — DO alarm idempotency", () => {
	test("alarm fired after terminal-state cancel is a no-op", async () => {
		const h = await build_harness();
		const create = await post_json(h.app, "/runs", { package_id: h.pkg.id, version_set_id: "vs_v1" });
		const { run_id } = expect_ok<{ run_id: string }>(create.body);

		// Reach `baking` with an alarm scheduled.
		await approve(h.app, run_id, "onebox", "approved");
		expect((await run_status_of(h.db, run_id)).status).toBe("baking");

		// Out-of-band cancel. Sets status to `cancelled` and calls
		// `deleteAlarm` — but a real DO race can still fire the alarm
		// after the status flipped. Drive that race manually.
		const cancel_res = await post_json(h.app, `/runs/${run_id}/cancel`, {});
		expect(cancel_res.status).toBe(200);
		expect((await run_status_of(h.db, run_id)).status).toBe("cancelled");

		const events_before = await events_of(h.db, run_id);
		const pulse_before = h.deps.pulse.emitted.length;
		const main_script = SCRIPT_NAME_FOR();
		const deploys_before = (await h.deps.cf.deployments.list(main_script)).ok
			? ((await h.deps.cf.deployments.list(main_script)) as { ok: true; value: unknown[] }).value.length
			: 0;

		// Fire the alarm — must not error, must not advance, must not emit pulse, must not deploy.
		await h.fire_alarm(run_id);

		const final = await run_status_of(h.db, run_id);
		expect(final.status).toBe("cancelled");
		expect(final.current_stage).toBe("onebox");

		const events_after = await events_of(h.db, run_id);
		expect(events_after.length).toBe(events_before.length);

		expect(h.deps.pulse.emitted.length).toBe(pulse_before);

		const deploys_after_list = await h.deps.cf.deployments.list(main_script);
		if (!deploys_after_list.ok) throw new Error("list failed");
		expect(deploys_after_list.value.length).toBe(deploys_before);
	});
});
