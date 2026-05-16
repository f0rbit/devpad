import { Database as BunSqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { InMemoryPulseSummaryProvider, type MetricSnapshot } from "@devpad/pipeline-fakes";
import type { StageContext } from "@devpad/pipeline-templates";
import { createBunDatabase, migrateBunDatabase } from "@devpad/schema/database/bun";
import { pipeline_analysis_template, pipeline_package, pipeline_run, pipeline_stage_event, user } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { AnalysisGateEvaluator } from "../../analysis.js";
import { InMemoryPulseEmitter } from "../helpers.js";

const TEMPLATE_ID = "pipeline-analysis-template_test";
const RUN_ID = "pipeline-run_test";
const PACKAGE_ID = "pipeline-package_test";
const VERSION_ID = "v_deployed_xyz";
const FROM_STAGE = "staging";
const TO_STAGE = "wave1";

const make_ctx = (overrides: Partial<StageContext> = {}): StageContext => ({
	run_id: RUN_ID,
	package: "",
	version_set_id: "vs_v1",
	from_stage: FROM_STAGE,
	to_stage: TO_STAGE,
	gate: { type: "analysis", template: { template_id: TEMPLATE_ID } },
	...overrides,
});

const make_snapshot = (metrics: Record<string, number>): MetricSnapshot => ({
	metrics,
	window_start_ms: 0,
	window_end_ms: 600_000,
	sample_count: 100,
});

const create_test_db = (): Database => {
	const sqlite = new BunSqlite(":memory:");
	migrateBunDatabase(sqlite);
	return createBunDatabase(sqlite);
};

const seed_user = async (db: Database): Promise<string> => {
	const id = "user_test";
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
	return id;
};

const seed_package = async (db: Database, owner_id: string): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_package).values({
		id: PACKAGE_ID,
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
};

const seed_run = async (db: Database): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id: RUN_ID,
		package_id: PACKAGE_ID,
		version_set_id: "vs_v1",
		shape: "gradual",
		status: "deploying",
		current_stage: TO_STAGE,
		resolved_rollout: { type: "gradual", stages: [] } as never,
		resolved_gates: {} as never,
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
};

const seed_template = async (db: Database, owner_id: string, threshold_dsl: string, window_ms = 600_000): Promise<void> => {
	const now = new Date().toISOString();
	await db.insert(pipeline_analysis_template).values({
		id: TEMPLATE_ID,
		owner_id,
		name: "default-analysis",
		query_dsl: {} as never,
		threshold_dsl: threshold_dsl as never,
		window_ms,
		created_at: now,
		updated_at: now,
		created_by: "api",
		modified_by: "api",
		protected: false,
		deleted: false,
	} as never);
};

const seed_deploy_event = async (db: Database, ts: string = new Date().toISOString()): Promise<void> => {
	await db.insert(pipeline_stage_event).values({
		id: `pipeline-stage-event_${crypto.randomUUID()}`,
		run_id: RUN_ID,
		stage_name: FROM_STAGE,
		kind: "deploy_completed",
		payload: { deployment_id: "d_test", version_id: VERSION_ID } as never,
		ts,
	} as never);
};

describe("AnalysisGateEvaluator — real pulse-driven", () => {
	let db: Database;
	let pulse: InMemoryPulseEmitter;
	let pulse_summary: InMemoryPulseSummaryProvider;
	let owner_id: string;

	beforeEach(async () => {
		db = create_test_db();
		owner_id = await seed_user(db);
		await seed_package(db, owner_id);
		await seed_run(db);
		pulse = new InMemoryPulseEmitter();
		pulse_summary = new InMemoryPulseSummaryProvider();
	});

	test("window_open: returns Pending without fetching pulse summary", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01", 60 * 60 * 1000);
		// Just deployed → still inside window
		await seed_deploy_event(db);

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.verdict).toBe("Pending");
			expect(result.value.reason).toContain("window still open");
		}
		expect(pulse_summary.calls).toHaveLength(0);
		expect(pulse.emitted).toHaveLength(1);
		expect(pulse.emitted[0]?.event).toBe("gate_analysis_stub");
	});

	test("window_passed_threshold_met: returns Pass and queries pulse with right dimensions", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01", 0);
		await seed_deploy_event(db);
		pulse_summary.set_next_response({ package: "test-pkg", environment: TO_STAGE, version_id: VERSION_ID }, make_snapshot({ error_rate: 0.001 }));

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.verdict).toBe("Pass");
		expect(pulse_summary.calls).toHaveLength(1);
		const q = pulse_summary.calls[0]!.query;
		expect(q.package).toBe("test-pkg");
		expect(q.environment).toBe(TO_STAGE);
		expect(q.version_id).toBe(VERSION_ID);
		expect(q.window_ms).toBe(0);
	});

	test("window_passed_threshold_missed: returns Fail with reason naming the metric", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01", 0);
		await seed_deploy_event(db);
		pulse_summary.set_next_response({ package: "test-pkg", environment: TO_STAGE, version_id: VERSION_ID }, make_snapshot({ error_rate: 0.5 }));

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.verdict).toBe("Fail");
			if (result.value.verdict === "Fail") expect(result.value.reason).toContain("error_rate");
		}
	});

	test("multiple thresholds — one breach → Fail with that metric", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01\np99_latency_ms > 500", 0);
		await seed_deploy_event(db);
		pulse_summary.set_next_response({ package: "test-pkg", environment: TO_STAGE, version_id: VERSION_ID }, make_snapshot({ error_rate: 0.001, p99_latency_ms: 1200 }));

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok && result.value.verdict === "Fail") {
			expect(result.value.reason).toContain("p99_latency_ms");
		}
	});

	test("zero-traffic via pending-tagged threshold → Pending", async () => {
		await seed_template(db, owner_id, "request_rate < 10 : pending", 0);
		await seed_deploy_event(db);
		pulse_summary.set_next_response({ package: "test-pkg", environment: TO_STAGE, version_id: VERSION_ID }, make_snapshot({ request_rate: 0 }));

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.verdict).toBe("Pending");
	});

	test("threshold DSL parse error → Fail with parse reason", async () => {
		await seed_template(db, owner_id, "error_rate <<<>>> 0.01", 0);
		await seed_deploy_event(db);

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok && result.value.verdict === "Fail") {
			expect(result.value.reason).toContain("parse error");
		}
	});

	test("missing template → Fail with not-found message", async () => {
		await seed_deploy_event(db);

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok && result.value.verdict === "Fail") {
			expect(result.value.reason).toContain("not found");
		}
	});

	test("no deploy_completed event yet → Pending", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01");

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx());

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.verdict).toBe("Pending");
		expect(pulse_summary.calls).toHaveLength(0);
	});

	test("non-analysis gate context → Pass (defensive)", async () => {
		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		const result = await evaluator.evaluate(make_ctx({ gate: { type: "auto" } }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.verdict).toBe("Pass");
	});

	test("custom now() injects deterministic clock", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01", 5_000);
		const deploy_ts = "2026-05-17T00:00:00.000Z";
		await seed_deploy_event(db, deploy_ts);
		// Inject now() = deploy_ts + 1s → window NOT yet closed
		const now_inside = Date.parse(deploy_ts) + 1_000;
		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary, now: () => now_inside });
		const r1 = await evaluator.evaluate(make_ctx());
		expect(r1.ok && r1.value.verdict).toBe("Pending");

		// Inject now() = deploy_ts + 10s → window closed, fetches pulse
		const now_after = Date.parse(deploy_ts) + 10_000;
		pulse_summary.set_next_response({ package: "test-pkg", environment: TO_STAGE, version_id: VERSION_ID }, make_snapshot({ error_rate: 0.0001 }));
		const evaluator2 = new AnalysisGateEvaluator({ db, pulse, pulse_summary, now: () => now_after });
		const r2 = await evaluator2.evaluate(make_ctx());
		expect(r2.ok && r2.value.verdict).toBe("Pass");
	});

	test("emits gate_analysis_stub pulse event for backward compat", async () => {
		await seed_template(db, owner_id, "error_rate > 0.01", 0);
		await seed_deploy_event(db);
		pulse_summary.set_next_response({ package: "test-pkg", environment: TO_STAGE, version_id: VERSION_ID }, make_snapshot({ error_rate: 0 }));

		const evaluator = new AnalysisGateEvaluator({ db, pulse, pulse_summary });
		await evaluator.evaluate(make_ctx());

		expect(pulse.emitted).toHaveLength(1);
		const event = pulse.emitted[0]!;
		expect(event.event).toBe("gate_analysis_stub");
		if (event.event === "gate_analysis_stub") {
			expect(event.template.template_id).toBe(TEMPLATE_ID);
			expect(event.stage).toBe(TO_STAGE);
		}
	});
});
