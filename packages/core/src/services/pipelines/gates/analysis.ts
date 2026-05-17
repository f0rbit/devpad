import type { PulseSummaryProvider } from "@devpad/pipeline-fakes/pulse-summary";
import type { GateVerdict, StageContext } from "@devpad/pipeline-templates";
import { pipeline_analysis_template, pipeline_package, pipeline_run, pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import type { Result } from "@f0rbit/corpus";
import { err, ok } from "@f0rbit/corpus";
import { and, desc, eq } from "drizzle-orm";
import { build_summary_query, evaluate_metrics_against_thresholds, is_window_open, type MetricSnapshot, parse_threshold_dsl, type Threshold } from "./analysis-domain.js";
import type { GateError, GateEvaluator, PulseEmitter } from "./evaluator.js";

type AnalysisTemplate = {
	template_id: string;
	threshold_dsl: string;
	window_ms: number;
};

type AnalysisRunCoordinates = {
	package_name: string;
	version_id: string;
	deploy_completed_at_ms: number;
};

const read_analysis_template = async (db: Database, template_id: string): Promise<Result<AnalysisTemplate, GateError>> => {
	try {
		const rows = await db.select().from(pipeline_analysis_template).where(eq(pipeline_analysis_template.id, template_id));
		const row = rows[0];
		if (!row) return err({ kind: "store_error", operation: "read_analysis_template", message: `template ${template_id} not found` });
		const threshold_dsl = typeof row.threshold_dsl === "string" ? row.threshold_dsl : JSON.stringify(row.threshold_dsl);
		return ok({
			template_id: row.id,
			threshold_dsl,
			window_ms: row.window_ms,
		});
	} catch (e) {
		return err({ kind: "store_error", operation: "read_analysis_template", message: String(e) });
	}
};

const read_run_coordinates = async (db: Database, run_id: string, from_stage: string): Promise<Result<AnalysisRunCoordinates, GateError>> => {
	try {
		const run_rows = await db.select({ package_id: pipeline_run.package_id }).from(pipeline_run).where(eq(pipeline_run.id, run_id));
		const run_row = run_rows[0];
		if (!run_row) return err({ kind: "store_error", operation: "read_run", message: `run ${run_id} not found` });

		const pkg_rows = await db.select({ name: pipeline_package.name }).from(pipeline_package).where(eq(pipeline_package.id, run_row.package_id));
		const pkg_row = pkg_rows[0];
		if (!pkg_row) return err({ kind: "store_error", operation: "read_package", message: `package ${run_row.package_id} not found` });

		// Read the deploy_completed event for the stage we're transitioning FROM —
		// that is the currently-running version whose metrics we evaluate. The
		// to-stage has not yet been deployed at the time the gate fires.
		const deploy_rows = await db
			.select()
			.from(pipeline_stage_event)
			.where(and(eq(pipeline_stage_event.run_id, run_id), eq(pipeline_stage_event.stage_name, from_stage), eq(pipeline_stage_event.kind, "deploy_completed")))
			.orderBy(desc(pipeline_stage_event.ts))
			.limit(1);
		const deploy_row = deploy_rows[0];
		if (!deploy_row) return err({ kind: "store_error", operation: "read_deploy_event", message: `no deploy_completed event for ${run_id}/${from_stage}` });

		const payload = (deploy_row.payload as { version_id?: string } | null) ?? {};
		if (!payload.version_id) return err({ kind: "store_error", operation: "read_deploy_event", message: "deploy_completed event missing version_id" });

		return ok({
			package_name: pkg_row.name,
			version_id: payload.version_id,
			deploy_completed_at_ms: Date.parse(deploy_row.ts),
		});
	} catch (e) {
		return err({ kind: "store_error", operation: "read_run_coordinates", message: String(e) });
	}
};

const fetch_snapshot = async (pulse_summary: PulseSummaryProvider, coords: AnalysisRunCoordinates, template: AnalysisTemplate, stage_name: string): Promise<Result<MetricSnapshot, GateError>> => {
	const query = build_summary_query({ window_ms: template.window_ms }, { package: coords.package_name, version_id: coords.version_id }, { name: stage_name });
	const result = await pulse_summary.fetch(query);
	if (!result.ok) {
		return err({ kind: "emit_error", message: `pulse summary fetch failed: ${result.error.code} ${result.error.message}` });
	}
	return ok(result.value);
};

const parse_thresholds_or_fail = (dsl: string): Result<Threshold[], GateError> => {
	const parsed = parse_threshold_dsl(dsl);
	if (!parsed.ok) {
		return err({ kind: "emit_error", message: `threshold_dsl parse error (line ${parsed.error.line}): ${parsed.error.message}` });
	}
	return ok(parsed.value);
};

/**
 * Real pulse-driven analysis gate.
 *
 * Orchestrates the side-effect layer: D1 read of the template + run
 * coordinates, pulse summary fetch, then hands the snapshot to the pure
 * domain functions in `analysis-domain.ts`. Returns:
 * - `Pass` — all thresholds met
 * - `Fail` — at least one threshold breached (reason names the metrics)
 * - `Pending` — window still open OR a "pending" threshold is breached
 *   (e.g. insufficient traffic to make a verdict)
 */
export class AnalysisGateEvaluator implements GateEvaluator {
	private db: Database;
	private pulse: PulseEmitter;
	private pulse_summary: PulseSummaryProvider;
	private now: () => number;

	constructor(deps: { db: Database; pulse: PulseEmitter; pulse_summary: PulseSummaryProvider; now?: () => number }) {
		this.db = deps.db;
		this.pulse = deps.pulse;
		this.pulse_summary = deps.pulse_summary;
		this.now = deps.now ?? Date.now;
	}

	async evaluate(ctx: StageContext): Promise<Result<GateVerdict, GateError>> {
		if (ctx.gate.type !== "analysis") {
			return ok({ verdict: "Pass" as const, reason: "invalid gate type" });
		}

		const template_result = await read_analysis_template(this.db, ctx.gate.template.template_id);
		if (!template_result.ok) {
			const error_reason = template_result.error.message ?? "analysis template unavailable";
			await this.pulse.emit({
				event: "gate_analysis_verdict",
				run_id: ctx.run_id,
				stage: ctx.to_stage,
				template: ctx.gate.template,
				verdict: "Fail",
				reason: error_reason,
			});
			return ok({ verdict: "Fail" as const, reason: error_reason });
		}
		const template = template_result.value;

		const thresholds_result = parse_thresholds_or_fail(template.threshold_dsl);
		if (!thresholds_result.ok) {
			const error_reason = thresholds_result.error.message ?? "threshold_dsl parse error";
			await this.pulse.emit({
				event: "gate_analysis_verdict",
				run_id: ctx.run_id,
				stage: ctx.to_stage,
				template: ctx.gate.template,
				verdict: "Fail",
				reason: error_reason,
			});
			return ok({ verdict: "Fail" as const, reason: error_reason });
		}

		const coords_result = await read_run_coordinates(this.db, ctx.run_id, ctx.from_stage);
		if (!coords_result.ok) {
			const error_reason = coords_result.error.message ?? "deploy not yet observable";
			await this.pulse.emit({
				event: "gate_analysis_verdict",
				run_id: ctx.run_id,
				stage: ctx.to_stage,
				template: ctx.gate.template,
				verdict: "Pending",
				reason: error_reason,
			});
			return ok({ verdict: "Pending" as const, reason: error_reason });
		}
		const coords = coords_result.value;

		if (is_window_open(this.now(), coords.deploy_completed_at_ms, template.window_ms)) {
			const reason = `analysis window still open (window_ms=${template.window_ms})`;
			await this.pulse.emit({
				event: "gate_analysis_verdict",
				run_id: ctx.run_id,
				stage: ctx.to_stage,
				template: ctx.gate.template,
				verdict: "Pending",
				reason,
			});
			return ok({ verdict: "Pending" as const, reason });
		}

		const snapshot_result = await fetch_snapshot(this.pulse_summary, coords, template, ctx.to_stage);
		if (!snapshot_result.ok) return snapshot_result;

		const verdict = evaluate_metrics_against_thresholds(snapshot_result.value, thresholds_result.value);
		await this.pulse.emit({
			event: "gate_analysis_verdict",
			run_id: ctx.run_id,
			stage: ctx.to_stage,
			template: ctx.gate.template,
			verdict: verdict.verdict,
			reason: verdict.reason,
		});
		return ok(verdict);
	}
}
