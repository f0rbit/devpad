/**
 * @module pipeline-templates
 *
 * Pure DSL for declaring deployment pipeline templates. Every export is
 * either a data shape, a pure constructor, or a deterministic function
 * over data — no IO, no time, no randomness. Downstream consumers in
 * `@devpad/core` (state machine, gate evaluators) and `@devpad/pipelines`
 * (Durable Object) get this package's outputs handed to them and never
 * have to reach back in.
 */

export { defaultAtomic, defaultAtomicGates } from "./default-atomic.ts";
export { defaultGradual, defaultGradualGates } from "./default-gradual.ts";
export {
	AnalysisGateSchema,
	AtomicRolloutSchema,
	AutoGateSchema,
	DurationSchema,
	GateSchema,
	GradualRolloutSchema,
	ManualGateSchema,
	PipelineTemplateSchema,
	RolloutSchema,
	StageSchema,
} from "./schema.ts";
export { type ResolvedRollout, resolve_rollout } from "./discriminator.ts";
export { type DslError, type ExtendTemplateOverrides, extendTemplate } from "./dsl.ts";
export { analysis, auto, manual } from "./gates.ts";
export { type DurationParseError, expand_rollout, parse_duration } from "./rollout.ts";
export type {
	AnalysisTemplateRef,
	BakeWindow,
	Duration,
	ForcedAtomicReason,
	Gate,
	GateVerdict,
	PipelineTemplate,
	Rollout,
	Stage,
	StageContext,
	TransitionKey,
} from "./types.ts";

// Scaffolder pure surface — consumed by `@devpad/cli` for `pipelines init`.
export {
	compute_compatibility_date,
	derive_template_vars,
	render_template,
	SCAFFOLDER_TEMPLATES,
	type TemplateEntry,
	validate_package_name,
} from "./scaffolder/index.ts";
export type {
	DefaultGateKind,
	RenderError as ScaffolderRenderError,
	RolloutMode,
	ScaffolderInput,
	TemplateVars,
	ValidationError as ScaffolderValidationError,
} from "./scaffolder/index.ts";
