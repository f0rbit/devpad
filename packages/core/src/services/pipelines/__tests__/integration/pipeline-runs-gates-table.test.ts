/**
 * Cartesian gate × rollout matrix.
 *
 * For each combination of {rollout: gradual, atomic} × {gate: manual,
 * auto, analysis-stub}, the run must complete with the right sequence
 * of `gate_verdict` events and `gate_pending_manual` / `gate_analysis_stub`
 * pulse events. Manual gates are scripted with a synchronous approve.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { extendTemplate, type Gate, type PipelineTemplate, type TransitionKey } from "@devpad/pipeline-templates";
import { pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { VersionSetManifest } from "@f0rbit/corpus";
import { eq } from "drizzle-orm";
import { advance_run, approve_stage, create_run, tick_bake_complete } from "../../runs.js";
import { create_test_db, make_deps, script_name_for, seed_package, seed_user } from "./helpers.js";

const manifest: VersionSetManifest = {
	package: "gates-table-pkg",
	git_sha: "abc",
	created_at: "2026-05-16T00:00:00Z",
	builds: {
		worker: { artifact_ref: "r2://x", size_bytes: 100, compatibility_date: "2025-01-01" },
	},
	migrations: { do_migrations: [] },
	env_manifest_ref: "r2://env",
	infra_plan_ref: "r2://infra",
};

type RolloutKind = "gradual" | "atomic";
type GateKind = "manual" | "auto" | "analysis";

const make_gate = (kind: GateKind): Gate => {
	if (kind === "manual") return { type: "manual" };
	if (kind === "auto") return { type: "auto", afterBake: true };
	return { type: "analysis", template: { template_id: "at_default" } };
};

const transitions_for_gradual: TransitionKey[] = ["staging→onebox", "onebox→wave1", "wave1→wave2", "wave2→full"];
const transitions_for_atomic: TransitionKey[] = ["staging→atomic-prod"];

const build_template = (rollout: RolloutKind, gate_kind: GateKind): PipelineTemplate => {
	const gates: Partial<Record<TransitionKey, Gate>> = {};
	const txns = rollout === "gradual" ? transitions_for_gradual : transitions_for_atomic;
	for (const t of txns) gates[t] = make_gate(gate_kind);
	const built = extendTemplate({
		rollout: rollout === "atomic" ? { type: "atomic" } : undefined,
		gates,
	});
	if (!built.ok) throw new Error(`build failed for ${rollout}/${gate_kind}: ${built.error.message}`);
	return built.value;
};

const drive_until_done = async (deps: ReturnType<typeof make_deps>, run_id: string, plan: Parameters<typeof advance_run>[3], gate_kind: GateKind): Promise<void> => {
	const r0 = await advance_run(deps, run_id, { kind: "start" }, plan);
	if (!r0.ok) throw new Error(`start failed: ${JSON.stringify(r0.error)}`);

	// Bounded poll: drive whichever event the current status calls for
	// until the run reaches a terminal state. Bound is `plan.stages.length * 4`
	// (deploy + bake + approve + tick safety per stage) so a buggy run
	// can't infinite-loop the suite.
	const max_steps = plan.stages.length * 4 + 4;
	for (let step = 0; step < max_steps; step++) {
		const row = (await deps.db.select().from(pipeline_run).where(eq(pipeline_run.id, run_id)))[0]!;
		if (row.status === "completed" || row.status === "failed" || row.status === "rolled_back" || row.status === "cancelled") return;

		if (row.status === "awaiting_approval") {
			if (gate_kind !== "manual") {
				throw new Error(`unexpected awaiting_approval for gate_kind=${gate_kind}`);
			}
			const stage_index = plan.stages.findIndex(s => s.name === row.current_stage);
			const to_stage = plan.stages[stage_index + 1]?.name;
			if (!to_stage) throw new Error("no next stage to approve");
			const approve = await approve_stage(deps, { run_id, stage_name: to_stage, decision: "approved", user_id: "user_test" }, plan);
			if (!approve.ok) throw new Error(`approve ${to_stage} failed: ${JSON.stringify(approve.error)}`);
			continue;
		}

		if (row.status === "baking") {
			const tick = await tick_bake_complete(deps, run_id, plan);
			if (!tick.ok) throw new Error(`bake tick failed: ${JSON.stringify(tick.error)}`);
			continue;
		}

		throw new Error(`drive loop stuck in status ${row.status} at step ${step}`);
	}
	throw new Error(`drive loop exceeded max_steps (${max_steps})`);
};

describe("cartesian gate × rollout matrix", () => {
	let db: Database;
	let deps: ReturnType<typeof make_deps>;
	let pkg_id: string;

	beforeEach(async () => {
		db = create_test_db();
		const u = await seed_user(db);
		const p = await seed_package(db, u.id);
		pkg_id = p.id;
		deps = make_deps(db);

		// Pre-seed a prior deployment so partial-traffic stages have a
		// predecessor to ramp down without bootstrapping to 100%.
		const script = script_name_for(pkg_id);
		const seed = await deps.cf.versions.upload({ script_name: script, annotations: { version_set_id: "vs_v0" } });
		if (!seed.ok) throw new Error("seed upload failed");
		await deps.cf.deployments.create({
			script_name: script,
			strategy: { strategy: "percentage", versions: [{ version_id: seed.value.id, percentage: 100 }] },
		});
	});

	const rollouts: RolloutKind[] = ["gradual", "atomic"];
	const gates: GateKind[] = ["manual", "auto", "analysis"];

	for (const rollout of rollouts) {
		for (const gate_kind of gates) {
			test(`${rollout} × ${gate_kind}: completes with the right gate_verdict events`, async () => {
				const template = build_template(rollout, gate_kind);
				const created = await create_run(db, {
					package_id: pkg_id,
					template,
					manifest,
					version_set_id: "vs_v1",
					previous_version_set_id: "vs_v0",
				});
				if (!created.ok) throw new Error(`create_run failed: ${created.error.message}`);
				const { run, plan } = created.value;
				const transitions = rollout === "gradual" ? transitions_for_gradual : transitions_for_atomic;

				await drive_until_done(deps, run.id, plan, gate_kind);

				const final = (await db.select().from(pipeline_run).where(eq(pipeline_run.id, run.id)))[0]!;
				expect(final.status).toBe("completed");

				// Gate verdict events recorded for every transition
				const events = await db.select().from(pipeline_stage_event).where(eq(pipeline_stage_event.run_id, run.id));
				const verdict_events = events.filter(e => e.kind === "gate_verdict");
				expect(verdict_events.length).toBe(transitions.length);
				for (const ev of verdict_events) {
					const payload = ev.payload as { type: string; verdict: string };
					expect(payload.verdict).toBe("Pass");
					expect(payload.type).toBe(gate_kind);
				}

				if (gate_kind === "manual") {
					// Each transition emits one gate_pending_manual pulse event.
					const pending = deps.pulse.emitted.filter(e => e.event === "gate_pending_manual");
					expect(pending.length).toBe(transitions.length);
				}
				if (gate_kind === "analysis") {
					const stub = deps.pulse.emitted.filter(e => e.event === "gate_analysis_stub");
					expect(stub.length).toBe(transitions.length);
				}
			});
		}
	}
});
