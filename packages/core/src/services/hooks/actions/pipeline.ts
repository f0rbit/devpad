/**
 * @module core/services/hooks/actions/pipeline
 *
 * v2.4 (task A3.4) — pipeline-run action executor. POSTs `{package_id}` to
 * the devpad-pipelines orchestrator's `POST /runs` and, on success, writes a
 * `references` edge on the event's subject task with
 * `ref: {type: "pipeline_run", run_id}` — the deploy-side half of the
 * metric tie (a pulse/pipeline dashboard can walk backwards from a task to
 * the run it triggered).
 *
 * Known gap, disclosed rather than silently half-implemented: the
 * orchestrator's `POST /runs` also requires `version_set_id` (see
 * `packages/pipelines/src/routes.ts`'s `create_run_body`), which a hook's
 * `{kind: "pipeline", package_id}` action has no way to supply yet. Firing
 * this action against the real orchestrator today gets a 400 (classified
 * here as a permanent failure, not a bug) until a follow-up either adds a
 * "run the package's latest version-set" convenience on the orchestrator or
 * extends the hook action shape with an optional `version_set_id`.
 */

import { add_link } from "../../graph/graph.js";
import type { Database } from "@devpad/schema/database/types";
import { z } from "zod";
import type { ActionExecutor, ActionResult } from "../dispatch.js";

export type PipelineExecutorDeps = {
	orchestrator_base: string;
	token: string;
	db: Database;
	fetch_impl?: typeof fetch;
};

const runs_wire_response = z.union([
	z.object({ ok: z.literal(true), value: z.object({ run_id: z.string().min(1) }) }),
	z.object({ ok: z.literal(false), error: z.unknown() }),
]);

export function PipelineActionExecutor(deps: PipelineExecutorDeps): ActionExecutor {
	return {
		async execute({ action, event }): Promise<ActionResult> {
			if (action.kind !== "pipeline") return { ok: false, transient: false, message: "executor/action kind mismatch" };

			const fetch_impl = deps.fetch_impl ?? fetch;
			let response: Response;
			try {
				response = await fetch_impl(`${deps.orchestrator_base}/runs`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
					body: JSON.stringify({ package_id: action.package_id }),
				});
			} catch (e) {
				return { ok: false, transient: true, message: `network error: ${e instanceof Error ? e.message : String(e)}` };
			}

			if (response.status >= 500) {
				return { ok: false, transient: true, message: `orchestrator responded ${String(response.status)}` };
			}
			if (!response.ok) {
				return { ok: false, transient: false, message: `orchestrator responded ${String(response.status)}` };
			}

			let wire_parsed: ReturnType<typeof runs_wire_response.safeParse>;
			try {
				wire_parsed = runs_wire_response.safeParse(await response.json());
			} catch {
				return { ok: false, transient: false, message: "orchestrator returned invalid JSON" };
			}
			if (!wire_parsed.success || !wire_parsed.data.ok) {
				return { ok: false, transient: false, message: "orchestrator response missing run_id" };
			}

			const link_result = await add_link(deps.db, {
				src_id: event.subject_id,
				dst_id: null,
				kind: "references",
				ref: { type: "pipeline_run", run_id: wire_parsed.data.value.run_id },
			});
			if (!link_result.ok) {
				return { ok: false, transient: true, message: "failed to record pipeline_run reference edge" };
			}
			return { ok: true };
		},
	};
}
