/**
 * @module core/services/pipelines/stage-events
 *
 * Plain `pipeline_stage_event` row appends. Extracted from `runs.ts` so
 * the external-deploy helpers can record without importing the runs
 * orchestration (avoids a module cycle through the same file).
 */

import type { PipelineStageEvent, StageEventKind } from "@devpad/schema";
import { pipeline_stage_event } from "@devpad/schema/database/schema";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";
import type { ServiceError } from "../errors.js";

const make_event_id = (): string => `pipeline-stage-event_${crypto.randomUUID()}`;

export const record_stage_event_row = async (
	db: Database,
	input: { run_id: string; stage_name: string; kind: StageEventKind; payload?: unknown },
): Promise<Result<PipelineStageEvent, ServiceError>> => {
	try {
		const insert_values = {
			id: make_event_id(),
			run_id: input.run_id,
			stage_name: input.stage_name,
			kind: input.kind,
			payload: input.payload ?? null,
			ts: new Date().toISOString(),
		};
		const inserted = await db
			.insert(pipeline_stage_event)
			.values(insert_values as never)
			.returning();
		const row = inserted.at(0);
		if (!row)
			return err({
				kind: "store_error",
				operation: "insert_pipeline_stage_event",
				message: "insert returned no row",
			});
		return ok(row);
	} catch (e) {
		return err({ kind: "store_error", operation: "insert_pipeline_stage_event", message: String(e) });
	}
};
