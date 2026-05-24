/**
 * @module @devpad/cli/printer
 *
 * Shared TTY-aware output helpers for the CLI. Centralises:
 *
 * - `make_spinner(text)` — returns an ora spinner in interactive shells,
 *   a no-op object in CI / non-TTY (so spinner glyphs don't garble
 *   pipeline logs).
 * - `fail_with(spinner, message)` — combines `spinner.fail(message)`
 *   with a stderr log + `process.exit(1)`. In non-TTY the spinner is
 *   silent, so the stderr log is the only thing CI sees.
 * - `print_next_steps(steps)` — formats a labelled bullet list with a
 *   leading blank line. TTY-aware via `chalk` (no-ops to plain text in
 *   non-TTY automatically through chalk's own detection).
 *
 * Keep this module zero-business-logic — just output formatting. Adding
 * domain-specific helpers belongs in the calling command module.
 */

import chalk from "chalk";
import ora from "ora";

export type Spinner = {
	start: (text?: string) => Spinner;
	succeed: (text?: string) => Spinner;
	fail: (text?: string) => Spinner;
	stop: () => Spinner;
};

/**
 * Build a spinner that no-ops when stdout isn't a TTY (CI). In non-TTY
 * mode `.fail(msg)` still logs the message to stderr so CI logs aren't
 * blank when the CLI exits non-zero.
 */
export const make_spinner = (text: string): Spinner => {
	if (process.stdout.isTTY) return ora(text) as unknown as Spinner;
	const log_stderr = (msg?: string): Spinner => {
		if (msg !== undefined && msg !== "") console.error(msg);
		return noop;
	};
	const noop: Spinner = {
		start: () => noop,
		succeed: () => noop,
		fail: log_stderr,
		stop: () => noop,
	};
	return noop;
};

/**
 * Fail a spinner with a message and exit non-zero. Always logs the
 * message to stderr (in non-TTY the spinner itself is silent, so the
 * stderr log is the only surfacing path).
 */
export const fail_with = (spinner: Spinner, message: string): never => {
	spinner.fail(message);
	console.error(`error: ${message}`);
	process.exit(1);
};

export type NextStep = { command: string; comment?: string };

/**
 * Print a labelled bullet list of next-step commands. Prepends a blank
 * line and a green checkmark header. Used by `pipelines init` after a
 * successful scaffold.
 */
export const print_next_steps = (header: string, steps: NextStep[], footer?: string): void => {
	console.log("");
	console.log(chalk.green(header));
	console.log("");
	console.log(chalk.bold("Next steps:"));
	for (const { command, comment } of steps) {
		const comment_text = comment === undefined ? "" : ` ${chalk.dim(`# ${comment}`)}`;
		console.log(`  ${chalk.dim("$")} ${command}${comment_text}`);
	}
	if (footer !== undefined) {
		console.log("");
		console.log(chalk.bold(footer));
	}
};
