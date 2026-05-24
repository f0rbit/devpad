/**
 * @module core/services/pipelines/__tests__/integration/events
 *
 * Coverage for `ingest_event`: happy-path insert, idempotent replay,
 * idempotency-key collision detection, run-not-found, caller-scope
 * mismatch, and DO-tick gating by event kind.
 *
 * Substrate: bun:sqlite + migrate (via `create_test_db`), an in-memory
 * pulse capturer, and an in-memory DO router that records each `/advance`
 * call so we can assert the tick contract without spinning up a real DO.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { ok, type Result } from "@f0rbit/corpus";
import { pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { eq } from "drizzle-orm";
import type { EventDeps, EventDoRouter, EventPulseEmitter, IngestEventInput } from "../../events.js";
import { ingest_event } from "../../events.js";
import { create_test_db, seed_package, seed_user } from "./helpers.js";

// ─── In-memory test doubles ─────────────────────────────────────────

class CapturingPulseEmitter implements EventPulseEmitter {
	public emitted: Array<{ event: string } & Record<string, unknown>> = [];
	async emit(event: { event: string } & Record<string, unknown>): Promise<void> {
		this.emitted.push(event);
	}
}

class RecordingDoRouter implements EventDoRouter {
	public calls: Array<{ run_id: string; path: string; body: unknown }> = [];
	async fetch(run_id: string, path: string, body: unknown): Promise<Response> {
		this.calls.push({ run_id, path, body });
		return new Response(JSON.stringify({ ok: true, value: {} }), { status: 200 });
	}
}

// ─── Fixture helpers ────────────────────────────────────────────────

const SEEDED_RUN_ID = "pipeline-run_seed";
const SEEDED_PACKAGE_ID = "pipeline-package_test";

async function seed_run(db: Database): Promise<void> {
	const now = new Date().toISOString();
	await db.insert(pipeline_run).values({
		id: SEEDED_RUN_ID,
		package_id: SEEDED_PACKAGE_ID,
		version_set_id: "vs_v1",
		shape: "atomic",
		kind: "deploy",
		status: "queued",
		current_stage: "staging",
		resolved_rollout: { type: "atomic" } as never,
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
}

type Harness = {
	db: Database;
	deps: EventDeps;
	pulse: CapturingPulseEmitter;
	do_router: RecordingDoRouter;
};

async function build_harness(): Promise<Harness> {
	const db = create_test_db();
	const u = await seed_user(db);
	await seed_package(db, u.id, { id: SEEDED_PACKAGE_ID });
	await seed_run(db);
	const pulse = new CapturingPulseEmitter();
	const do_router = new RecordingDoRouter();
	return { db, deps: { db, pulse, do: do_router }, pulse, do_router };
}

const base_input = (overrides: Partial<IngestEventInput> = {}): IngestEventInput => ({
	run_id: SEEDED_RUN_ID,
	package_id: SEEDED_PACKAGE_ID,
	stage_name: "staging",
	kind: "warning",
	payload: { detail: "hi" },
	idempotency_key: "11111111-1111-4111-8111-111111111111",
	...overrides,
});

const expect_ok = <T, E>(r: Result<T, E>): T => {
	if (!r.ok) throw new Error(`expected ok, got error: ${JSON.stringify(r.error)}`);
	return r.value;
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("ingest_event — happy path", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("inserts a new pipeline_stage_event row and returns duplicated:false", async () => {
		const out = expect_ok(await ingest_event(h.deps, base_input()));
		expect(out.duplicated).toBe(false);
		expect(out.event_id).toMatch(/^pipeline-stage-event_/);

		const rows = await h.db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.id, out.event_id));
		expect(rows).toHaveLength(1);
		expect(rows[0]!.kind).toBe("warning");
		expect(rows[0]!.stage_name).toBe("staging");
		// payload.source must be stamped server-side
		expect((rows[0]!.payload as Record<string, unknown>).source).toBe("external");
		// idempotency_hash present
		expect(typeof rows[0]!.idempotency_hash).toBe("string");
		expect(rows[0]!.idempotency_hash?.length).toBe(64);
	});

	test("server-side stamps payload.source even when caller provides one", async () => {
		const out = expect_ok(
			await ingest_event(h.deps, base_input({ payload: { source: "attacker-claimed", note: "x" } }))
		);
		const row = (await h.db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.id, out.event_id)))[0]!;
		expect((row.payload as Record<string, unknown>).source).toBe("external");
		expect((row.payload as Record<string, unknown>).note).toBe("x");
	});

	test("pulse emit fires with the expected shape", async () => {
		await ingest_event(h.deps, base_input());
		expect(h.pulse.emitted).toHaveLength(1);
		expect(h.pulse.emitted[0]!.event).toBe("stage_event_external");
		expect(h.pulse.emitted[0]!.run_id).toBe(SEEDED_RUN_ID);
		expect(h.pulse.emitted[0]!.package_id).toBe(SEEDED_PACKAGE_ID);
		expect(h.pulse.emitted[0]!.stage_name).toBe("staging");
		expect(h.pulse.emitted[0]!.kind).toBe("warning");
	});

	test("pulse emit failure does NOT fail the call", async () => {
		const flaky: EventPulseEmitter = { emit: async () => Promise.reject(new Error("boom")) };
		const r = await ingest_event({ ...h.deps, pulse: flaky }, base_input());
		expect(r.ok).toBe(true);
	});
});

describe("ingest_event — idempotency", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("replay with same key + same payload returns duplicated:true and DOES NOT double-insert", async () => {
		const input = base_input();
		const first = expect_ok(await ingest_event(h.deps, input));
		const second = expect_ok(await ingest_event(h.deps, input));
		expect(second.duplicated).toBe(true);
		expect(second.event_id).toBe(first.event_id);

		const all = await h.db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, SEEDED_RUN_ID));
		expect(all).toHaveLength(1);
	});

	test("SHA-256 hash is deterministic — same content yields the same hash", async () => {
		const input = base_input();
		const first = expect_ok(await ingest_event(h.deps, input));
		const second_h = await build_harness();
		const replay = expect_ok(await ingest_event(second_h.deps, input));

		// Different DB, but the row stored its hash in column form — pull
		// both and compare directly.
		const a = (await h.db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.id, first.event_id)))[0]!;
		const b = (await second_h.db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.id, replay.event_id)))[0]!;
		expect(a.idempotency_hash).toBe(b.idempotency_hash);
	});

	test("same key with DIFFERENT payload returns validation_error", async () => {
		const key = "22222222-2222-4222-8222-222222222222";
		const first = await ingest_event(h.deps, base_input({ idempotency_key: key, payload: { v: 1 } }));
		expect(first.ok).toBe(true);

		const collision = await ingest_event(h.deps, base_input({ idempotency_key: key, payload: { v: 2 } }));
		expect(collision.ok).toBe(false);
		if (collision.ok) throw new Error("unreachable");
		expect(collision.error.kind).toBe("validation_error");
		if (collision.error.kind === "validation_error") {
			expect(collision.error.field).toBe("idempotency_key");
		}
	});
});

describe("ingest_event — authorization + lookup failures", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("404 not_found when run_id is unknown", async () => {
		const r = await ingest_event(h.deps, base_input({ run_id: "pipeline-run_does-not-exist" }));
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error("unreachable");
		expect(r.error.kind).toBe("not_found");
	});

	test("403 forbidden when caller package_id does not match the run's", async () => {
		const r = await ingest_event(h.deps, base_input({ package_id: "pipeline-package_attacker" }));
		expect(r.ok).toBe(false);
		if (r.ok) throw new Error("unreachable");
		expect(r.error.kind).toBe("forbidden");
	});
});

describe("ingest_event — DO tick gating", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await build_harness();
	});

	test("informational events do NOT tick the DO", async () => {
		await ingest_event(h.deps, base_input({ kind: "warning" }));
		await ingest_event(h.deps, base_input({ kind: "error", idempotency_key: "33333333-3333-4333-8333-333333333333" }));
		await ingest_event(h.deps, base_input({ kind: "deploy_started", idempotency_key: "44444444-4444-4444-8444-444444444444" }));
		expect(h.do_router.calls).toHaveLength(0);
	});

	test("deploy_completed ticks the DO with /advance + external_event", async () => {
		await ingest_event(h.deps, base_input({ kind: "deploy_completed" }));
		// Pulse emit + DO tick are fire-and-forget — give the event loop a
		// chance to flush before asserting.
		await Promise.resolve();
		await Promise.resolve();
		expect(h.do_router.calls).toHaveLength(1);
		expect(h.do_router.calls[0]!.path).toBe("/advance");
		expect(h.do_router.calls[0]!.run_id).toBe(SEEDED_RUN_ID);
		expect(h.do_router.calls[0]!.body).toEqual({ kind: "external_event", event_kind: "deploy_completed" });
	});

	test("gate_verdict ticks the DO", async () => {
		await ingest_event(h.deps, base_input({ kind: "gate_verdict" }));
		await Promise.resolve();
		await Promise.resolve();
		expect(h.do_router.calls).toHaveLength(1);
		expect((h.do_router.calls[0]!.body as { event_kind: string }).event_kind).toBe("gate_verdict");
	});

	test("rollback_completed ticks the DO", async () => {
		await ingest_event(h.deps, base_input({ kind: "rollback_completed" }));
		await Promise.resolve();
		await Promise.resolve();
		expect(h.do_router.calls).toHaveLength(1);
		expect((h.do_router.calls[0]!.body as { event_kind: string }).event_kind).toBe("rollback_completed");
	});
});

// satisfy lint when ok isn't used elsewhere
void ok;
