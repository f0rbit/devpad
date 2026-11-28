/**
 * @module core/services/pipelines/row-parse
 *
 * Zod validation of the `mode: "json"` columns on pipeline rows
 * (verification-hardening 2.1). The columns carry TS types via
 * `.$type<z.infer<typeof X>>()`, but the runtime value on the row is
 * whatever D1 returns — a corrupted/hand-edited row must surface as a
 * typed `store_error` at read time, never as a silently-wrong object
 * flowing into the state machine or the UI.
 *
 * Pure — no DB access. `get_run`/`list_runs`, `get_package`/`list_packages`
 * and `events.ts`'s run read all funnel their rows through here.
 */

import type { PipelinePackage, PipelineRun } from "@devpad/schema";
import { external_target, resolved_gates, resolved_rollout, script_name_overrides } from "@devpad/schema/validation";
import { err, ok, type Result } from "@f0rbit/corpus";
import type { ZodError } from "zod";
import type { ServiceError } from "../errors.js";

const issues_message = (error: ZodError): string => {
	const first = error.issues.at(0);
	if (!first) return "unexpected schema rejection";
	const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
	return `${path}${first.message}`;
};

export const parse_run_row = (row: PipelineRun): Result<PipelineRun, ServiceError> => {
	const rollout = resolved_rollout.safeParse(row.resolved_rollout);
	if (!rollout.success) {
		return err({
			kind: "store_error",
			operation: "read_pipeline_run",
			message: `pipeline_run ${row.id} resolved_rollout failed schema: ${issues_message(rollout.error)}`,
		});
	}
	const gates = resolved_gates.safeParse(row.resolved_gates);
	if (!gates.success) {
		return err({
			kind: "store_error",
			operation: "read_pipeline_run",
			message: `pipeline_run ${row.id} resolved_gates failed schema: ${issues_message(gates.error)}`,
		});
	}
	return ok(row);
};

export const parse_package_row = (row: PipelinePackage): Result<PipelinePackage, ServiceError> => {
	const target = external_target.nullable().safeParse(row.external_target);
	if (!target.success) {
		return err({
			kind: "store_error",
			operation: "read_pipeline_package",
			message: `pipeline_package ${row.id} external_target failed schema: ${issues_message(target.error)}`,
		});
	}
	const overrides = script_name_overrides.nullable().safeParse(row.script_name_overrides);
	if (!overrides.success) {
		return err({
			kind: "store_error",
			operation: "read_pipeline_package",
			message: `pipeline_package ${row.id} script_name_overrides failed schema: ${issues_message(overrides.error)}`,
		});
	}
	return ok(row);
};
