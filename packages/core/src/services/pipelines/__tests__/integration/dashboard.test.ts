/**
 * @module core/services/pipelines/__tests__/integration/dashboard
 *
 * Coverage for the pure D1 `get_dashboard` aggregator and its helpers.
 * Substrate: bun:sqlite via `create_test_db`. No network, no pulse query.
 *
 * Verifies (per Phase 2.D.1 adversary checklist):
 *   - Empty window → zero counts + null p50/p95 + null rollback_rate.
 *   - Percentile handles N=0 (null) and N=1 (returns that value).
 *   - rollback_rate handles deploy_count=0 → null (NOT Infinity).
 *   - Verdict groups read the gate type from `resolved_gates` JSON
 *     (NOT hard-coded by stage name).
 *   - Multi-run aggregation: counts, percentiles, approvals, rollback rate.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { pipeline_approval, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { compute_percentile, count_rollbacks, get_dashboard, group_verdicts } from "../../dashboard.js";
import { create_test_db, seed_package, seed_user } from "./helpers.js";

// ─── Fixture helpers ────────────────────────────────────────────────

const PKG_ID = "pipeline-package_test";
const NOW = new Date("2026-05-24T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type SeedRunOpts = {
	id?: string;
	package_id?: string;
	kind?: "deploy" | "rollback";
	status?: "queued" | "deploying" | "baking" | "awaiting_approval" | "rolling_back" | "completed" | "rolled_back" | "failed" | "cancelled";
	started_at?: string | null;
	finished_at?: string | null;
	resolved_gates?: Record<string, unknown>;
};

const default_resolved_gates = (): Record<string, unknown> => ({
	"staging→atomic-prod": { type: "manual" },
});

async function seed_run(db: Database, opts: SeedRunOpts = {}): Promise<string> {
	const id = opts.id ?? `pipeline-run_${crypto.randomUUID()}`;
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id,
		package_id: opts.package_id ?? PKG_ID,
		version_set_id: "vs_v1",
		shape: "atomic",
		kind: opts.kind ?? "deploy",
		status: opts.status ?? "completed",
		current_stage: null,
		resolved_rollout: { type: "atomic" } as never,
		resolved_gates: (opts.resolved_gates ?? default_resolved_gates()) as never,
		forced_atomic_reason: null,
		started_at: opts.started_at === undefined ? new Date(NOW.getTime() - 30 * 60_000).toISOString() : opts.started_at,
		finished_at: opts.finished_at === undefined ? new Date(NOW.getTime() - 25 * 60_000).toISOString() : opts.finished_at,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
	return id;
}

type SeedVerdictOpts = {
	run_id: string;
	stage_name?: string;
	verdict: "pass" | "fail" | "pending";
};

async function seed_verdict_event(db: Database, opts: SeedVerdictOpts): Promise<void> {
	await db.insert(pipeline_stage_event).values({
		id: `pipeline-stage-event_${crypto.randomUUID()}`,
		run_id: opts.run_id,
		stage_name: opts.stage_name ?? "staging",
		kind: "gate_verdict",
		payload: { verdict: opts.verdict } as never,
		ts: new Date().toISOString(),
		idempotency_hash: null,
	} as never);
}

type SeedApprovalOpts = {
	run_id: string;
	created_at?: string;
	decided_at?: string | null;
};

async function seed_approval(db: Database, opts: SeedApprovalOpts): Promise<void> {
	await db.insert(pipeline_approval).values({
		id: `pipeline-approval_${crypto.randomUUID()}`,
		run_id: opts.run_id,
		stage_name: "staging",
		decision: opts.decided_at ? "approved" : null,
		reason: null,
		decided_by: opts.decided_at ? "user_test" : null,
		decided_at: opts.decided_at ?? null,
		created_at: opts.created_at ?? new Date().toISOString(),
		updated_at: new Date().toISOString(),
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
}

async function setup(): Promise<Database> {
	const db = create_test_db();
	const u = await seed_user(db);
	await seed_package(db, u.id, { id: PKG_ID });
	return db;
}

const expect_snapshot = async (db: Database) => {
	const r = await get_dashboard({ db }, { package_id: PKG_ID, window_ms: DAY, now: NOW });
	if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
	return r.value;
};

// ─── Pure-helper tests ──────────────────────────────────────────────

describe("compute_percentile", () => {
	test("N=0 returns null (not NaN, not 0)", () => {
		expect(compute_percentile([], 0.5)).toBeNull();
		expect(compute_percentile([], 0.95)).toBeNull();
	});

	test("N=1 returns that single value for both p50 and p95", () => {
		expect(compute_percentile([42], 0.5)).toBe(42);
		expect(compute_percentile([42], 0.95)).toBe(42);
	});

	test("sorted ascending and indexed at floor(N*p)", () => {
		// 10 values → floor(10*0.5)=5, floor(10*0.95)=9
		const values = [10, 5, 3, 8, 1, 9, 7, 2, 6, 4]; // sorted: 1..10
		expect(compute_percentile(values, 0.5)).toBe(6);
		expect(compute_percentile(values, 0.95)).toBe(10);
	});

	test("p=1 doesn't overshoot — clamps to last element", () => {
		expect(compute_percentile([1, 2, 3], 1)).toBe(3);
	});
});

describe("count_rollbacks", () => {
	test("deploy_count=0 returns null rate (not Infinity)", () => {
		const out = count_rollbacks([{ kind: "rollback" }, { kind: "rollback" }]);
		expect(out.deploys).toBe(0);
		expect(out.rollbacks).toBe(2);
		expect(out.rate).toBeNull();
	});

	test("rate = rollbacks/deploys", () => {
		const out = count_rollbacks([{ kind: "deploy" }, { kind: "deploy" }, { kind: "deploy" }, { kind: "deploy" }, { kind: "rollback" }]);
		expect(out.rate).toBe(0.25);
	});

	test("no rollbacks → rate = 0 (not null) when there are deploys", () => {
		const out = count_rollbacks([{ kind: "deploy" }, { kind: "deploy" }]);
		expect(out.rate).toBe(0);
	});
});

describe("group_verdicts", () => {
	test("reads gate type from resolved_gates JSON keyed on the stage prefix", () => {
		const events = [
			{ run_id: "r1", stage_name: "staging", payload: { verdict: "pass" } },
			{ run_id: "r1", stage_name: "wave-1", payload: { verdict: "fail" } },
			{ run_id: "r1", stage_name: "wave-2", payload: { verdict: "pending" } },
		];
		const resolved = new Map<string, Record<string, unknown>>([
			[
				"r1",
				{
					"staging→wave-1": { type: "manual" },
					"wave-1→wave-2": { type: "analysis" },
					"wave-2→atomic-prod": { type: "auto" },
				},
			],
		]);
		const out = group_verdicts(events, resolved);
		expect(out.manual.pass).toBe(1);
		expect(out.analysis.fail).toBe(1);
		expect(out.auto.pending).toBe(1);
	});

	test("event with no matching gate in resolved_gates is silently dropped", () => {
		const events = [{ run_id: "r1", stage_name: "ghost-stage", payload: { verdict: "pass" } }];
		const resolved = new Map<string, Record<string, unknown>>([["r1", { "staging→atomic-prod": { type: "manual" } }]]);
		const out = group_verdicts(events, resolved);
		expect(out.manual.pass).toBe(0);
		expect(out.analysis.pass).toBe(0);
		expect(out.auto.pass).toBe(0);
	});
});

// ─── End-to-end aggregator tests ────────────────────────────────────

describe("get_dashboard — empty window", () => {
	let db: Database;
	beforeEach(async () => {
		db = await setup();
	});

	test("zero counts across the board + null percentiles + null rollback_rate", async () => {
		const snap = await expect_snapshot(db);
		expect(snap.run_counts).toEqual({ total: 0, completed: 0, failed: 0, cancelled: 0, rolled_back: 0, in_flight: 0 });
		expect(snap.verdict_counts).toEqual({
			manual: { pass: 0, fail: 0, pending: 0 },
			auto: { pass: 0, fail: 0, pending: 0 },
			analysis: { pass: 0, fail: 0, pending: 0 },
		});
		expect(snap.latency_p50_ms).toBeNull();
		expect(snap.latency_p95_ms).toBeNull();
		expect(snap.approval_turnaround_p50_ms).toBeNull();
		expect(snap.rollback_rate).toBeNull();
	});

	test("runs OUTSIDE the window are excluded", async () => {
		// Run started 2 days ago, with a 24h window we should see zero.
		await seed_run(db, { started_at: new Date(NOW.getTime() - 2 * DAY).toISOString() });
		const snap = await expect_snapshot(db);
		expect(snap.run_counts.total).toBe(0);
	});
});

describe("get_dashboard — single completed run", () => {
	let db: Database;
	beforeEach(async () => {
		db = await setup();
	});

	test("100% completed; p50 = p95 = the duration", async () => {
		const started = new Date(NOW.getTime() - 10 * 60_000).toISOString();
		const finished = new Date(NOW.getTime() - 5 * 60_000).toISOString();
		await seed_run(db, { status: "completed", started_at: started, finished_at: finished });

		const snap = await expect_snapshot(db);
		expect(snap.run_counts).toEqual({ total: 1, completed: 1, failed: 0, cancelled: 0, rolled_back: 0, in_flight: 0 });
		expect(snap.latency_p50_ms).toBe(5 * 60_000);
		expect(snap.latency_p95_ms).toBe(5 * 60_000);
	});
});

describe("get_dashboard — multi-run aggregation", () => {
	let db: Database;
	beforeEach(async () => {
		db = await setup();
	});

	test("status counts split correctly across in-flight + terminal", async () => {
		await seed_run(db, { status: "completed" });
		await seed_run(db, { status: "completed" });
		await seed_run(db, { status: "failed" });
		await seed_run(db, { status: "cancelled" });
		await seed_run(db, { status: "rolled_back", kind: "rollback" });
		await seed_run(db, { status: "deploying", finished_at: null });
		await seed_run(db, { status: "awaiting_approval", finished_at: null });

		const snap = await expect_snapshot(db);
		expect(snap.run_counts).toEqual({ total: 7, completed: 2, failed: 1, cancelled: 1, rolled_back: 1, in_flight: 2 });
	});

	test("verdict counts derived from resolved_gates lookup", async () => {
		const run_id = await seed_run(db, {
			resolved_gates: {
				"staging→wave-1": { type: "manual" },
				"wave-1→atomic-prod": { type: "analysis" },
			},
		});
		await seed_verdict_event(db, { run_id, stage_name: "staging", verdict: "pass" });
		await seed_verdict_event(db, { run_id, stage_name: "staging", verdict: "fail" });
		await seed_verdict_event(db, { run_id, stage_name: "wave-1", verdict: "pass" });

		const snap = await expect_snapshot(db);
		expect(snap.verdict_counts.manual.pass).toBe(1);
		expect(snap.verdict_counts.manual.fail).toBe(1);
		expect(snap.verdict_counts.analysis.pass).toBe(1);
		// No verdicts in the other buckets.
		expect(snap.verdict_counts.auto.pass).toBe(0);
		expect(snap.verdict_counts.analysis.fail).toBe(0);
	});

	test("approval turnaround p50", async () => {
		const r1 = await seed_run(db, { id: "pipeline-run_a", status: "completed" });
		const r2 = await seed_run(db, { id: "pipeline-run_b", status: "completed" });
		const r3 = await seed_run(db, { id: "pipeline-run_c", status: "completed" });
		await seed_approval(db, {
			run_id: r1,
			created_at: "2026-05-24T11:00:00.000Z",
			decided_at: "2026-05-24T11:01:00.000Z", // 60s
		});
		await seed_approval(db, {
			run_id: r2,
			created_at: "2026-05-24T11:00:00.000Z",
			decided_at: "2026-05-24T11:05:00.000Z", // 300s
		});
		await seed_approval(db, {
			run_id: r3,
			created_at: "2026-05-24T11:00:00.000Z",
			decided_at: null, // pending — excluded
		});

		const snap = await expect_snapshot(db);
		// Two decided approvals: 60_000 and 300_000. floor(2*0.5)=1 → 300_000.
		expect(snap.approval_turnaround_p50_ms).toBe(300_000);
	});

	test("rollback_rate counts deploy vs rollback runs in window", async () => {
		await seed_run(db, { kind: "deploy", status: "completed" });
		await seed_run(db, { kind: "deploy", status: "completed" });
		await seed_run(db, { kind: "deploy", status: "completed" });
		await seed_run(db, { kind: "deploy", status: "failed" });
		await seed_run(db, { kind: "rollback", status: "completed" });

		const snap = await expect_snapshot(db);
		expect(snap.rollback_rate).toBe(0.25); // 1 rollback / 4 deploys
	});

	test("isolates package_id — runs for OTHER packages are excluded", async () => {
		await seed_package(db, "user_test", { id: "pipeline-package_other", name: "other" });
		await seed_run(db, { status: "completed", package_id: "pipeline-package_other" });
		await seed_run(db, { status: "completed", package_id: PKG_ID });

		const snap = await expect_snapshot(db);
		expect(snap.run_counts.total).toBe(1);
		expect(snap.run_counts.completed).toBe(1);
	});
});
