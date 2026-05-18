/**
 * @module pipeline-templates/scaffolder/types
 *
 * Pure data shapes for the CLI scaffolder. The scaffolder is split into
 * two strict layers: this file plus {@link ./domain.ts} are pure (no IO,
 * no clock, no random); the side-effect orchestrator lives one layer up
 * in `@devpad/cli`.
 */

/** How the rollout should be shaped by default in the generated `pipeline.ts`. */
export type RolloutMode = "gradual" | "atomic";

/** Default gate the generated `pipeline.ts` applies to every transition. */
export type DefaultGateKind = "manual" | "auto" | "analysis";

/** Build output shape — determines which CLI flags the workflow uses. */
export type BuildShape = "single-file" | "directory-bundle";

/**
 * Input the CLI feeds into the scaffolder. All optional flags are
 * surfaced here at full type strength so the validator can refuse bad
 * combinations at the boundary, not deep inside a render call.
 */
export type ScaffolderInput = {
	package_name: string;
	rollout: RolloutMode;
	default_gate: DefaultGateKind;
	build_shape: BuildShape;
	now: Date;
};

/**
 * Substituted into every template via {@link render_template}. Derived
 * deterministically from {@link ScaffolderInput} — see
 * {@link ./domain.ts#derive_template_vars}.
 */
export type TemplateVars = {
	package_name: string;
	package_name_pascal: string;
	package_name_constant: string;
	compatibility_date: string;
	rollout: RolloutMode;
	default_gate: DefaultGateKind;
	build_shape: BuildShape;
	rollout_block: string;
	gates_block: string;
	gate_import: string;
};

/** Reason {@link ./domain.ts#validate_package_name} rejected an input. */
export type ValidationError =
	| { code: "package_name_empty"; message: string }
	| { code: "package_name_too_long"; message: string; length: number }
	| { code: "package_name_invalid_chars"; message: string; name: string };

/** Reason {@link ./domain.ts#render_template} failed. */
export type RenderError = { code: "missing_var"; message: string; var: string; template_snippet: string };
