/**
 * @module pipeline-templates/scaffolder
 *
 * Pure surface of the CLI scaffolder. The side-effect orchestrator
 * (filesystem IO, `git init`, `bun install`) lives in `@devpad/cli`.
 */

export { compute_compatibility_date, derive_template_vars, render_template, validate_package_name } from "./domain";
export { SCAFFOLDER_TEMPLATES, type TemplateEntry } from "./manifest";
export type {
	BuildShape,
	DefaultGateKind,
	RenderError,
	RolloutMode,
	ScaffolderInput,
	TemplateVars,
	ValidationError,
} from "./types";
