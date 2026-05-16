/**
 * @module @devpad/cli/commands/pipelines
 *
 * `devpad pipelines …` subcommand group: `init`, `run`, `approve`,
 * `cancel`, `rollback`. `init` shells out to the scaffolder; the others
 * wrap `client.pipelines.*` so we never re-implement HTTP plumbing.
 */

import path from "node:path";
import { type ApiClient, ApiClient as ApiClientCtor } from "@devpad/api";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { scaffold_package, type ScaffolderError } from "../scaffolder/index.ts";
import type { DefaultGateKind, RolloutMode } from "../scaffolder/types.ts";

type Spinner = { start: (text?: string) => Spinner; succeed: (text?: string) => Spinner; fail: (text?: string) => Spinner; stop: () => Spinner };

const make_spinner = (text: string): Spinner => {
	if (process.stdout.isTTY) return ora(text) as unknown as Spinner;
	const noop: Spinner = {
		start: () => noop,
		succeed: () => noop,
		fail: () => noop,
		stop: () => noop,
	};
	return noop;
};

const ROLLOUT_MODES = ["gradual", "atomic"] as const;
const GATE_KINDS = ["manual", "auto", "analysis"] as const;

const is_rollout_mode = (s: string): s is RolloutMode => (ROLLOUT_MODES as readonly string[]).includes(s);
const is_gate_kind = (s: string): s is DefaultGateKind => (GATE_KINDS as readonly string[]).includes(s);

const fail_with = (spinner: Spinner, message: string): never => {
	spinner.fail(message);
	process.exit(1);
};

const format_scaffolder_error = (e: ScaffolderError): string => {
	if (e.code === "render_failed") return `${e.message}\n  variable: ${e.cause.var}\n  near: ${e.cause.template_snippet}`;
	if (e.code === "target_exists") return `${e.message}\n  remove it or pass --dir to a fresh path`;
	return e.message;
};

const print_next_steps = (target_dir: string, package_name: string, rollout: RolloutMode): void => {
	const rel = path.relative(process.cwd(), target_dir) || ".";
	console.log("");
	console.log(chalk.green(`✓ Scaffolded ${package_name} at ${target_dir}`));
	console.log("");
	console.log(chalk.bold("Next steps:"));
	console.log(`  ${chalk.dim("$")} cd ${rel}`);
	console.log(`  ${chalk.dim("$")} bun dev                            ${chalk.dim("# local wrangler dev")}`);
	console.log(`  ${chalk.dim("$")} devpad pipelines run ${package_name}    ${chalk.dim(`# trigger a ${rollout} pipeline run`)}`);
	console.log(`  ${chalk.dim("$")} devpad pipelines approve <run-id> <stage>`);
	console.log("");
	console.log(chalk.bold('Read AGENTS.md for hard rules — esp. "don\'t deploy manually".'));
};

export const action_init = async (name: string, options: { rollout: string; defaultGate: string; dir?: string; skipInstall?: boolean; skipGit?: boolean }): Promise<void> => {
	const spinner = make_spinner(`Scaffolding ${name}...`).start();

	if (!is_rollout_mode(options.rollout)) return fail_with(spinner, `--rollout must be one of ${ROLLOUT_MODES.join(", ")}; got "${options.rollout}"`);
	if (!is_gate_kind(options.defaultGate)) return fail_with(spinner, `--default-gate must be one of ${GATE_KINDS.join(", ")}; got "${options.defaultGate}"`);

	const target_dir = path.resolve(options.dir ?? path.join(process.cwd(), name));

	const result = await scaffold_package({
		package_name: name,
		target_dir,
		rollout: options.rollout,
		default_gate: options.defaultGate,
		skip_install: options.skipInstall === true,
		skip_git: options.skipGit === true,
	});

	if (!result.ok) return fail_with(spinner, format_scaffolder_error(result.error));

	spinner.succeed(`Scaffolded ${result.value.files_written.length} files`);
	print_next_steps(result.value.target_dir, result.value.package_name, options.rollout);
};

const default_client_factory = (): ApiClient => {
	const api_key = process.env.DEVPAD_API_KEY ?? Bun.env.DEVPAD_API_KEY;
	const base_url = process.env.DEVPAD_BASE_URL ?? "https://devpad.tools/api/v1";
	if (api_key === undefined || api_key === "") {
		console.error(chalk.red("Error: DEVPAD_API_KEY environment variable is required"));
		console.error(chalk.yellow("Get your API key from https://devpad.tools/account"));
		process.exit(1);
	}
	return new ApiClientCtor({ api_key, base_url });
};

const print_json = (data: unknown): void => {
	process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
};

type ClientFactory = () => ApiClient;

const action_run = (client_factory: ClientFactory) => async (package_id?: string): Promise<void> => {
	const spinner = make_spinner("Starting pipeline run...").start();
	if (package_id === undefined) return fail_with(spinner, "package required: `devpad pipelines run <package-id>`");
	const client = client_factory();
	const result = await client.pipelines.create({ package_id, version_set_id: "latest" });
	if (!result.ok) return fail_with(spinner, result.error.message);
	spinner.succeed(`run ${result.value.run_id} (${result.value.status})`);
	print_json(result.value);
};

const action_approve = (client_factory: ClientFactory) => async (run_id: string, stage: string, options: { user?: string; reason?: string }): Promise<void> => {
	const spinner = make_spinner(`Approving ${run_id} @ ${stage}...`).start();
	const user_id = options.user ?? process.env.DEVPAD_USER_ID;
	if (user_id === undefined) return fail_with(spinner, "--user required (or DEVPAD_USER_ID env var)");
	const client = client_factory();
	const result = await client.pipelines.approve(run_id, {
		stage_name: stage,
		decision: "approved",
		user_id,
		reason: options.reason,
	});
	if (!result.ok) return fail_with(spinner, result.error.message);
	spinner.succeed(`approved ${run_id} @ ${stage}`);
};

const action_cancel = (client_factory: ClientFactory) => async (run_id: string): Promise<void> => {
	const spinner = make_spinner(`Cancelling ${run_id}...`).start();
	const client = client_factory();
	const result = await client.pipelines.cancel(run_id);
	if (!result.ok) return fail_with(spinner, result.error.message);
	spinner.succeed(`cancelled ${run_id}`);
};

const action_rollback = (client_factory: ClientFactory) => async (run_id: string): Promise<void> => {
	const spinner = make_spinner(`Rolling back ${run_id}...`).start();
	const client = client_factory();
	const result = await client.pipelines.rollback(run_id);
	if (!result.ok) return fail_with(spinner, result.error.message);
	spinner.succeed(`rolled back ${run_id}`);
};

/**
 * Mount the `pipelines` subcommand group on a Commander program. The
 * factory pattern keeps `pipelines init` callable without a configured
 * API key — the client is only built when the run/approve/cancel/rollback
 * subcommands actually fire.
 */
export const register_pipelines_commands = (program: Command, client_factory: ClientFactory = default_client_factory): Command => {
	const pipelines = program.command("pipelines").description("Manage pipeline-managed Worker packages");

	pipelines
		.command("init <name>")
		.description("Scaffold a new pipeline-managed Worker package")
		.option("--rollout <mode>", "Rollout mode: gradual | atomic", "gradual")
		.option("--default-gate <kind>", "Default gate: manual | auto | analysis", "auto")
		.option("--dir <path>", "Target directory (default: $PWD/<name>)")
		.option("--skip-install", "Skip `bun install` after scaffolding", false)
		.option("--skip-git", "Skip `git init` after scaffolding", false)
		.action(action_init);

	pipelines
		.command("run [package]")
		.description("Trigger a pipeline run for a package")
		.action(action_run(client_factory));

	pipelines
		.command("approve <run-id> <stage>")
		.description("Approve a gated stage transition")
		.option("--user <user-id>", "User ID granting approval (defaults to $DEVPAD_USER_ID)")
		.option("--reason <text>", "Optional approval reason")
		.action(action_approve(client_factory));

	pipelines
		.command("cancel <run-id>")
		.description("Cancel an in-flight pipeline run")
		.action(action_cancel(client_factory));

	pipelines
		.command("rollback <run-id>")
		.description("Roll a run back to its previous production version")
		.action(action_rollback(client_factory));

	return pipelines;
};
