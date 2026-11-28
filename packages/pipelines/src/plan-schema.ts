/**
 * @module pipelines/plan-schema
 *
 * Zod mirror of `ResolvedPlan` (`@devpad/core/services/pipelines`) for the
 * Durable Object boundary: the plan arrives in a request body and is
 * persisted to / read back from DO storage, both untyped. The `satisfies`
 * clause makes any drift between this schema and the core type a compile
 * error, so the schema can't silently rot.
 */

import type { ResolvedPlan } from "@devpad/core/services/pipelines";
import { z } from "zod";

const stage = z.object({
	name: z.string(),
	traffic: z.number(),
	bake: z.object({ ms: z.number() }).nullable(),
});

const gate = z.discriminatedUnion("type", [
	z.object({ type: z.literal("manual") }),
	z.object({ type: z.literal("auto"), afterBake: z.boolean().optional() }),
	z.object({ type: z.literal("analysis"), template: z.object({ template_id: z.string() }) }),
]);

const run_target = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("version_set"), version_set_id: z.string() }),
	z.object({ kind: z.literal("commit"), commit_sha: z.string() }),
]);

export const resolved_plan_schema = z.object({
	stages: z.array(stage),
	gates: z.record(z.string(), gate),
	forced_reason: z.enum(["do_migrations", "asset_affinity_none"]).nullable(),
	target: run_target,
	previous_version_set_id: z.string().nullable(),
	external_timeout_ms: z.number().nullable(),
}) satisfies z.ZodType<ResolvedPlan, z.ZodTypeDef, unknown>;
