/**
 * @module pipeline-templates/types
 *
 * Pure data shapes for declaring deployment rollouts and stage transitions.
 * Every value defined here is plain JSON-friendly data — no methods, no side
 * effects, no references to runtime services. Consumers in `@devpad/core`
 * (orchestrator, gate evaluators) and `@devpad/pipelines` (Durable Object)
 * persist these shapes verbatim onto `pipeline_run.resolved_rollout` and
 * `pipeline_run.resolved_gates` at run start, so the template is the
 * source-of-truth-on-disk for an in-flight run.
 */

/**
 * A parsed duration in milliseconds. The DSL accepts the shorthand
 * `"30m" | "1h" | "0"` via {@link parse_duration}; everywhere else passes the
 * normalised `{ ms }` shape so consumers never need a parser.
 */
export type Duration = { ms: number };

/** Alias for the bake-window stored on a {@link Stage}. */
export type BakeWindow = Duration;

/** Reference to a Phase 1 stub / Phase 2 real analysis-template row. */
export type AnalysisTemplateRef = { template_id: string };

/** Discriminated transition key — typos compile-error against {@link Stage.name}. */
export type TransitionKey = `${string}→${string}`;

/**
 * A gate dictates how the orchestrator decides whether to advance past a
 * particular transition. Pure data — the evaluator implementation lives in
 * `@devpad/core/services/pipelines/gates/*` so this package stays free of
 * runtime concerns.
 */
export type Gate = { type: "manual" } | { type: "auto"; afterBake?: boolean } | { type: "analysis"; template: AnalysisTemplateRef };

/** Verdict returned by an evaluator and emitted to the state machine. */
export type GateVerdict = { verdict: "Pass"; reason?: string } | { verdict: "Fail"; reason: string } | { verdict: "Pending" };

/**
 * A single stage in the rollout: a fraction of traffic to land at, plus the
 * bake window the orchestrator waits before evaluating the *next* gate.
 *
 * `traffic` is a percentage 0..100. `bake: null` means "no wait".
 */
export type Stage = {
	name: string;
	traffic: number;
	bake: BakeWindow | null;
};

/**
 * The declared rollout shape for a package. `gradual` carries an explicit
 * ordered stage list with bake windows; `atomic` is the single-shot
 * zero→hundred path the orchestrator takes when the manifest forbids
 * percentage rollouts (DO migrations, unaffinitised assets) or the package
 * opts into it for low-importance services.
 */
export type Rollout =
	| {
			type: "gradual";
			stages: Array<{ name: string; traffic: number; bake: Duration }>;
	  }
	| { type: "atomic" };

/** Why an originally-`gradual` declaration was rewritten to `atomic` at run start. */
export type ForcedAtomicReason = "do_migrations" | "asset_affinity_none";

/**
 * Forward-compat slot for Phase 3 deployment blockers (time-of-day, holidays,
 * etc.). Phase 1 always ships an empty array.
 */
export type PreDeployCheck = { kind: string; policy: string };

/** Forward-compat slot mirroring {@link PreDeployCheck}. */
export type PostDeployCheck = { kind: string; policy: string };

/**
 * Top-level package template. `gates` is keyed by the literal transition
 * string (e.g. `"staging→onebox"`) so a typo in the override DSL becomes a
 * compile error rather than a silent no-op.
 */
export type PipelineTemplate = {
	rollout: Rollout;
	gates: Record<TransitionKey, Gate>;
	pre_deploy_checks: PreDeployCheck[];
	post_deploy_checks: PostDeployCheck[];
};

/**
 * Read-only context handed to a gate evaluator at runtime. This package
 * defines the shape but does not consume it — evaluators in `@devpad/core`
 * receive it from the Durable Object wrapper.
 */
export type StageContext = {
	run_id: string;
	package: string;
	version_set_id: string;
	from_stage: string;
	to_stage: string;
	gate: Gate;
};
