/**
 * @module pipeline-templates/schema
 *
 * Zod runtime validators that mirror the static `PipelineTemplate` shape
 * declared in `./types.ts`. Locks the on-wire contract used when a
 * compiled `pipeline.ts` is serialised to JSON and uploaded to the
 * `pipeline-templates` corpus store. The orchestrator parses incoming
 * template blobs through {@link PipelineTemplateSchema} before handing
 * the typed value to the state machine.
 *
 * Anything outside the schema's surface (functions, top-level await,
 * `process.env` references) is dropped silently by `JSON.stringify` —
 * the parser will reject the survivor as malformed, which is the
 * intended behaviour: `pipeline.ts` MUST be pure declaration.
 */

import { z } from "zod";
import type { Gate, PipelineTemplate, Rollout } from "./types.ts";

export const DurationSchema = z.object({ ms: z.number().int().min(0) });

export const StageSchema = z.object({
	name: z.string(),
	traffic: z.number().min(0).max(100),
	bake: DurationSchema,
});

export const GradualRolloutSchema = z.object({
	type: z.literal("gradual"),
	stages: z.array(StageSchema),
});

export const AtomicRolloutSchema = z.object({
	type: z.literal("atomic"),
});

export const RolloutSchema: z.ZodType<Rollout> = z.discriminatedUnion("type", [
	GradualRolloutSchema,
	AtomicRolloutSchema,
]);

export const ManualGateSchema = z.object({ type: z.literal("manual") });
export const AutoGateSchema = z.object({ type: z.literal("auto"), afterBake: z.boolean().optional() });
export const AnalysisGateSchema = z.object({
	type: z.literal("analysis"),
	template: z.object({ template_id: z.string() }),
});

export const GateSchema: z.ZodType<Gate> = z.discriminatedUnion("type", [
	ManualGateSchema,
	AutoGateSchema,
	AnalysisGateSchema,
]);

/**
 * Top-level pipeline template schema. Source of truth for the serialised
 * JSON blob persisted in the `pipeline-templates` corpus store. Mirrors
 * the {@link PipelineTemplate} static type.
 *
 * `gates` is a record keyed by `TransitionKey` (`${from}→${to}`). Zod
 * doesn't enforce the template-literal narrowing at runtime — that's a
 * compile-time guarantee on the DSL side. The schema accepts any string
 * key whose value is a valid {@link Gate}.
 */
export const PipelineTemplateSchema: z.ZodType<PipelineTemplate> = z.object({
	rollout: RolloutSchema,
	gates: z.record(GateSchema),
});
