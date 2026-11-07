/**
 * @module core/services/pipelines/__tests__/integration/external-deploy
 *
 * External deploy mode (#155) end-to-end coverage at the service layer:
 * the acceptance flow (create with commit_sha → CI staging event →
 * awaiting_approval → human approve → exactly-one production dispatch →
 * CI production events → completed, with ZERO Cloudflare calls +
 * events beneath the gate, and uses bun:sqlite migration replay like the
 * rest.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { InMemoryDispatcher } from "@devpad/pipeline-fakes";
import type { ExternalTarget, PipelineRun } from "@devpad/schema";
import { pipeline_dispatch, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import {
	advance_run,
	apply_external_event,
	approve_stage,
	create_external_run,
	external_plan,
	redispatch,
	tick_deploy_timeout,
} from "../../runs.js";
import type { ResolvedPlan, TransitionOutput } from "../../state-machine.js";
import { create_test_db, make_deps, seed_package, seed_user, type TestDeps } from "./helpers.js";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

const external_target_fixture: ExternalTarget = {
	repo: "acme/my-pkg",
	workflow: "deploy.yml",
	ref: "main",
	timeout_ms: 2_700_000,
	gate: { type: "manual" },
};

type Harness = {
	db: Database;
	deps: TestDeps;
	dispatcher: InMemoryDispatcher;
};

async function build_harness(): Promise<Harness> {
	const db = create_test_db();
	const u = await seed_user(db);
	await seed_package(db, u.id, {
		id: "pipeline-package_ext",
		name: "ext-pkg",
		deploy_mode: "external",
		external_target: external_target_fixture,
	});
	const dispatcher = new InMemoryDispatcher();
	const deps = make_deps(db, { dispatcher });
	return { db, deps, dispatcher };
}

const events_for = async (db: Database, run_id: string) =>
	db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run_id));

const run_row = async (db: Database, run_id: string): Promise<PipelineRun> => {
	const rows = await db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id));
	return rows[0]!;
};

async function new_deploy_run(h: Harness, commit_sha = COMMIT_A): Promise<{ run: PipelineRun; plan: ResolvedPlan }> {
	const created = await create_external_run(h.db, {
		package_id: "pipeline-package_ext",
		commit_sha,
		external_target: external_target_fixture,
		kind: "deploy",
	});
	if (!created.ok) throw new Error(`create_external_run failed: ${JSON.stringify(created.error)}`);

	// The route kicks the run off via the DO; the service-level equivalent
	// is the `start` event.
	return created.value;
}

type RunWithPlan = Awaited<ReturnType<typeof new_deploy_run>>;

async function start_run(h: Harness, ctx: RunWithPlan): Promise<void> {
	const started = await apply_start(h, ctx);
	expect(started.ok).toBe(true);
}

async function apply_start(h: Harness, ctx: RunWithPlan) {
	return advance_run(
		h.deps,
		ctx.run.id,
		{ kind: "start" },
		external_plan(external_target_fixture, ctx.run.commit_sha!),
	);
}

async function ci_event(
	h: Harness,
	ctx: RunWithPlan,
	input: { kind: "deploy_completed" | "deploy_failed"; stage_name: string; sha: string },
) {
	return apply_external_event(h.deps, ctx.run.id, {
		event_kind: input.kind,
		stage_name: input.stage_name,
		payload: { sha: input.sha },
	});
}

async function approve(h: Harness, ctx: RunWithPlan, decision: "approved" | "denied") {
	return approve_stage(
		h.deps,
		{ run_id: ctx.run.id, stage_name: "production", decision, user_id: "user_test" },
		ctx.plan,
	);
}

const expect_ok = <T>(r: { ok: boolean; error?: unknown; value?: T }): T => {
	if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
	return r.value as T;
};

describe("external mode — acceptance flow", () => {
	let h: Harness;
	let ctx: RunWithPlan;

	beforeEach(async () => {
		h = await build_harness();
		ctx = await new_deploy_run(h);
	});

	test("staging no-op parks in deploying; event → awaiting; approve → one dispatch; production event → completed; zero CF", async () => {
		await start_run(h, ctx);
		const after_start = await run_row(h.db, ctx.run.id);
		expect(after_start.status).toBe("deploying");
		expect(after_start.current_stage).toBe("staging");

		// CI deployed staging BEFORE creating the run — the orchestrator's
		// staging deploy is a no-op, so the only CF work so far is none.
		expect(h.deps.bundles.calls).toHaveLength(0);
		const staging_versions = await h.deps.cf.deployments.list("ext-pkg-staging");
		expect(staging_versions.ok).toBe(false); // never touched by the orchestrator

		// CI reports staging deploy_completed for the run's SHA.
		const staged = await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "staging", sha: COMMIT_A });
		expect(staged.ok).toBe(true);
		expect(expect_ok(staged).acted).toBe(true);
		const after_staging_event = await run_row(h.db, ctx.run.id);
		expect(after_staging_event.status).toBe("awaiting_approval");

		// Human approves (staging→production manual gate).
		const approved = await approve(h, ctx, "approved");
		expect(approved.ok).toBe(true);
		expect((approved.value as TransitionOutput).kind).toBe("needs_deploy");

		// Exactly ONE dispatch, with the expected inputs; the row is
		// dispatched + audit-attributed to the approving human.
		expect(h.dispatcher.dispatched).toHaveLength(1);
		expect(h.dispatcher.dispatched[0]).toEqual({
			repo: "acme/my-pkg",
			workflow: "deploy.yml",
			ref: "main",
			inputs: { stage: "production", sha: COMMIT_A, run_id: ctx.run.id },
		});
		const dispatch_rows = await h.db.select().from(pipeline_dispatch).where(eq(pipeline_dispatch.run_id, ctx.run.id));
		expect(dispatch_rows).toHaveLength(1);
		expect(dispatch_rows[0]!.status).toBe("dispatched");
		expect(dispatch_rows[0]!.requested_by).toBe("user_test");
		expect(dispatch_rows[0]!.commit_sha).toBe(COMMIT_A);

		// Zero Cloudflare writes throughout: bundle provider never called.
		expect(h.deps.bundles.calls).toHaveLength(0);

		const deploying = await run_row(h.db, ctx.run.id);
		expect(deploying.status).toBe("deploying");
		expect(deploying.current_stage).toBe("production");

		// CI performs the production deploy and reports back.
		const started_info = await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "production", sha: COMMIT_A });
		expect(started_info.ok).toBe(true);
		const finished = await run_row(h.db, ctx.run.id);
		expect(finished.status).toBe("completed");
		expect(finished.finished_at).not.toBeNull();
		expect(h.dispatcher.dispatched).toHaveLength(1);
	});

	test("double approval races → still exactly one dispatch", async () => {
		await start_run(h, ctx);
		expect_ok(await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "staging", sha: COMMIT_A }));

		const first = await approve(h, ctx, "approved");
		expect(first.ok).toBe(true);
		const second = await approve(h, ctx, "approved");
		// The run already left `awaiting_approval` — the second decision is
		// rejected (the approval row itself is still recorded for audit).
		expect(second.ok).toBe(false);
		expect(h.dispatcher.dispatched).toHaveLength(1);
	});

	test("denial fails the run with zero dispatches", async () => {
		await start_run(h, ctx);
		expect_ok(await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "staging", sha: COMMIT_A }));
		const denied = await approve(h, ctx, "denied");
		expect(denied.ok).toBe(true);
		const final = await run_row(h.db, ctx.run.id);
		expect(final.status).toBe("failed");
		expect(h.dispatcher.dispatched).toHaveLength(0);
	});

	test("wrong sha / wrong stage events are typed no-ops", async () => {
		await start_run(h, ctx);
		const wrong_sha = await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "staging", sha: COMMIT_B });
		expect(expect_ok(wrong_sha)).toEqual({ acted: false, reason: "sha_mismatch", terminal: false });

		const wrong_stage = await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "production", sha: COMMIT_A });
		expect(expect_ok(wrong_stage)).toEqual({ acted: false, reason: "stage_mismatch", terminal: false });

		const malformed = await apply_external_event(h.deps, ctx.run.id, {
			event_kind: "deploy_completed",
			stage_name: "staging",
		});
		expect(expect_ok(malformed)).toEqual({ acted: false, reason: "malformed_payload", terminal: false });

		expect(h.dispatcher.dispatched).toHaveLength(0);
		const still = await run_row(h.db, ctx.run.id);
		expect(still.status).toBe("deploying");
	});
});

describe("external mode — orchestrated runs ignore external events", () => {
	test("committed version_set run receives deploy_completed → no-op", async () => {
		const db = create_test_db();
		const u = await seed_user(db);
		await seed_package(db, u.id);
		const now = new Date().toISOString();
		await db.insert(pipeline_run).values({
			id: "pipeline-run_orch",
			package_id: "pipeline-package_test",
			version_set_id: "vs_v1",
			shape: "atomic",
			kind: "deploy",
			status: "deploying",
			current_stage: "staging",
			resolved_rollout: { type: "atomic" },
			resolved_gates: {},
			forced_atomic_reason: null,
			started_at: now,
			finished_at: null,
			created_at: now,
			updated_at: now,
			created_by: "api",
			modified_by: "api",
			protected: false,
			deleted: false,
		} as never);
		const dispatcher = new InMemoryDispatcher();
		const deps = make_deps(db, { dispatcher });
		const outcome = expect_ok(
			await apply_external_event(deps, "pipeline-run_orch", {
				event_kind: "deploy_completed",
				stage_name: "staging",
				payload: { sha: COMMIT_A },
			}),
		);
		expect(outcome).toEqual({ acted: false, reason: "orchestrated_run", terminal: false });
	});
});

describe("external mode — timeout alarm semantics", () => {
	test("timeout → unconfirmed + timed_out event; late deploy_completed completes; deploy_failed fails", async () => {
		const h = await build_harness();
		const ctx = await new_deploy_run(h);
		await start_run(h, ctx);

		const timed = await tick_deploy_timeout(h.deps, ctx.run.id, ctx.plan);
		expect(timed.ok).toBe(true);
		const parked = await run_row(h.db, ctx.run.id);
		expect(parked.status).toBe("unconfirmed");
		const timed_out_events = (await events_for(h.db, ctx.run.id)).filter((e) => e.kind === "timed_out");
		expect(timed_out_events).toHaveLength(1);

		// Late-but-valid CI arrival resumes through the unconfirmed state.
		const resumed = await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "staging", sha: COMMIT_A });
		expect(expect_ok(resumed).acted).toBe(true);
		const after = await run_row(h.db, ctx.run.id);
		expect(after.status).toBe("awaiting_approval");

		// A deploy_failed arrival (post-approval, production stage, run
		// deploying again) fails the run.
		expect_ok(await approve(h, ctx, "approved"));
		const failed = await ci_event(h, ctx, { kind: "deploy_failed", stage_name: "production", sha: COMMIT_A });
		expect(expect_ok(failed).acted).toBe(true);
		const final = await run_row(h.db, ctx.run.id);
		expect(final.status).toBe("failed");
	});
});

describe("external mode — dispatch failure + redispatch", () => {
	test("dispatch failure parks the run; guarded redispatch fires exactly once; second redispatch rejected", async () => {
		const h = await build_harness();
		const ctx = await new_deploy_run(h);
		await start_run(h, ctx);
		expect_ok(await ci_event(h, ctx, { kind: "deploy_completed", stage_name: "staging", sha: COMMIT_A }));

		h.dispatcher.fail_next = "workflow dispatch bounced (503)";
		const approved = await approve(h, ctx, "approved");
		// The dispatch failure does NOT crash the advance — the run parks.
		expect(approved.ok).toBe(true);
		const parked = await run_row(h.db, ctx.run.id);
		expect(parked.status).toBe("deploying");
		expect(h.dispatcher.dispatched).toHaveLength(0);

		const failed_row = (await h.db.select().from(pipeline_dispatch).where(eq(pipeline_dispatch.run_id, ctx.run.id))).at(
			0,
		);
		expect(failed_row!.status).toBe("failed");
		expect(failed_row!.error).toContain("503");
		const failed_events = (await events_for(h.db, ctx.run.id)).filter((e) => e.kind === "dispatch_failed");
		expect(failed_events).toHaveLength(1);

		// Redispatch works from a failed row…
		const again = await redispatch(h.deps, ctx.run.id, "user_other");
		expect(again.ok).toBe(true);
		expect(h.dispatcher.dispatched).toHaveLength(1);
		expect(h.dispatcher.dispatched[0]!.inputs).toEqual({ stage: "production", sha: COMMIT_A, run_id: ctx.run.id });
		const dispatched_row = (
			await h.db.select().from(pipeline_dispatch).where(eq(pipeline_dispatch.run_id, ctx.run.id))
		).at(0);
		expect(dispatched_row!.status).toBe("dispatched");
		expect(dispatched_row!.requested_by).toBe("user_other");

		// …and a second redispatch is rejected again (row no longer failed).
		const once_too_many = await redispatch(h.deps, ctx.run.id, "user_other");
		expect(once_too_many.ok).toBe(false);
		expect(h.dispatcher.dispatched).toHaveLength(1);
	});
});
