/**
 * @module @devpad/cli/scaffolder/types
 *
 * Side-effect orchestrator type shapes for `devpad pipelines init`. The
 * pure layer lives in `@devpad/pipeline-templates/scaffolder`; this
 * module wraps it with filesystem + process IO.
 */

import type { BuildShape, DefaultGateKind, RolloutMode, ScaffolderInput, ScaffolderRenderError, ScaffolderValidationError } from "@devpad/pipeline-templates";

export type { BuildShape, DefaultGateKind, RolloutMode, ScaffolderInput };

/** What the CLI tells the orchestrator. Captured at the boundary; pure layer takes a `now: Date`. */
export type ScaffoldRequest = {
	package_name: string;
	target_dir: string;
	rollout: RolloutMode;
	default_gate: DefaultGateKind;
	build_shape: BuildShape;
	skip_install?: boolean;
	skip_git?: boolean;
};

/** Reported back to the CLI on success. */
export type ScaffoldedPackage = {
	package_name: string;
	target_dir: string;
	files_written: string[];
	git_initialised: boolean;
	deps_installed: boolean;
};

/**
 * Every failure mode of the side-effect orchestrator. The CLI maps these
 * to exit codes; the pure render/validate errors are re-surfaced here.
 */
export type ScaffolderError =
	| { code: "validation_failed"; message: string; cause: ScaffolderValidationError }
	| { code: "render_failed"; message: string; template: string; cause: ScaffolderRenderError }
	| { code: "target_exists"; message: string; target_dir: string }
	| { code: "template_read_failed"; message: string; template: string }
	| { code: "write_failed"; message: string; path: string }
	| { code: "git_init_failed"; message: string }
	| { code: "install_failed"; message: string };
