/**
 * @module @devpad/cli/scaffolder
 *
 * Public surface of the CLI's `pipelines init` orchestrator. Re-exports
 * the side-effect `scaffold_package` plus types.
 */

export { resolve_templates_root, scaffold_package, type ScaffoldOptions, SCAFFOLDER_TEMPLATES } from "./scaffold.ts";
export type { DefaultGateKind, RolloutMode, ScaffoldedPackage, ScaffolderError, ScaffoldRequest, ScaffolderInput } from "./types.ts";
