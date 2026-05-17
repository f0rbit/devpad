/**
 * @module @devpad/cli/commands/pipelines
 *
 * `devpad pipelines …` subcommand group: `init`, `runs start`, `approve`,
 * `cancel`, `rollback`, `artifacts upload`. `init` shells out to the scaffolder;
 * the others wrap `client.pipelines.*` so we never re-implement HTTP plumbing.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type ApiClient, ApiClient as ApiClientCtor } from "@devpad/api";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { createCorpusBackend } from "../corpus-backend.ts";
import {
	type ArtifactInputs,
	type VersionSetOutput,
	build_manifest,
	compute_hash,
	validate_artifact_paths,
} from "../pipelines-artifacts-helpers.ts";
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
	console.log(`  ${chalk.dim("$")} devpad pipelines runs start        ${chalk.dim(`# trigger a ${rollout} pipeline run`)}`);
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

interface ArtifactsUploadOptions {
	package: string;
	bundle: string;
	manifest: string;
	infraPlan: string;
	pipeline: string;
	grants: string;
	output: string;
	gitSha?: string;
	compatibilityDate?: string;
}

export const action_artifacts_upload = async (options: ArtifactsUploadOptions): Promise<void> => {
	const spinner = make_spinner("Uploading artifacts to corpus...").start();

	const inputs: ArtifactInputs = {
		package_name: options.package,
		bundle_path: options.bundle,
		manifest_path: options.manifest,
		infra_plan_path: options.infraPlan,
		pipeline_path: options.pipeline,
		grants_path: options.grants,
		git_sha: options.gitSha,
		compatibility_date: options.compatibilityDate,
	};

	const validation_result = validate_artifact_paths(inputs);
	if (!validation_result.ok) return fail_with(spinner, validation_result.error.message);

	const bundle = readFileSync(options.bundle);
	const manifest_text = readFileSync(options.manifest, "utf8");
	const manifest_obj = JSON.parse(manifest_text);
	const infra_plan = readFileSync(options.infraPlan);
	const pipeline = readFileSync(options.pipeline);
	const grants = readFileSync(options.grants);

	const bundle_hash = compute_hash(bundle).slice(0, 12);
	const manifest_hash = compute_hash(Buffer.from(manifest_text)).slice(0, 12);
	const infra_plan_hash = compute_hash(infra_plan).slice(0, 12);
	const pipeline_hash = compute_hash(pipeline).slice(0, 12);
	const grants_hash = compute_hash(grants).slice(0, 12);

	const artifacts = {
		bundle,
		bundle_ref: `worker-bundles/${bundle_hash}`,
		manifest: manifest_obj,
		manifest_ref: `env-manifests/${manifest_hash}`,
		infra_plan,
		infra_plan_ref: `infra-plans/${infra_plan_hash}`,
		pipeline,
		pipeline_ref: `pipelines/${pipeline_hash}`,
		grants,
		grants_ref: `grants/${grants_hash}`,
	};

	const manifest_result = build_manifest(inputs, artifacts);
	if (!manifest_result.ok) return fail_with(spinner, manifest_result.error.message);

	const backend = await createCorpusBackend();
	const { version_set_store } = await import("@f0rbit/corpus");
	const version_sets = version_set_store(backend);

	const put_result = await version_sets.put(manifest_result.value);
	if (!put_result.ok) {
		const error_msg = put_result.error.kind === "storage_error" ? put_result.error.cause?.message || "Storage error" : "Failed to store manifest";
		return fail_with(spinner, error_msg);
	}

	const version_set_id = put_result.value.version;
	const output: VersionSetOutput = {
		id: version_set_id,
		version: version_set_id,
		package: inputs.package_name,
	};

	writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
	spinner.succeed("Artifacts uploaded successfully");
	console.log(chalk.green(`Version Set ID: ${version_set_id}`));
};

interface RunsStartOptions {
	package: string;
	versionSetId: string;
}

const action_runs_start = (client_factory: ClientFactory) => async (options: RunsStartOptions): Promise<void> => {
	const spinner = make_spinner("Starting pipeline run...").start();
	const client = client_factory();
	const result = await client.pipelines.create({ package_id: options.package, version_set_id: options.versionSetId });
	if (!result.ok) return fail_with(spinner, result.error.message);
	spinner.succeed(`run ${result.value.run_id} (${result.value.status})`);
	console.log(chalk.green(`Run ID: ${result.value.run_id}`));
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

	const artifacts = pipelines.command("artifacts").description("Manage pipeline artifacts");

	artifacts
		.command("upload")
		.description("Upload artifacts to corpus")
		.requiredOption("--package <name>", "Package name")
		.requiredOption("--bundle <path>", "Path to worker bundle (dist/_worker.js)")
		.requiredOption("--manifest <path>", "Path to manifest (dist/manifest.json)")
		.requiredOption("--infra-plan <path>", "Path to infra plan (infra.ts)")
		.requiredOption("--pipeline <path>", "Path to pipeline definition (pipeline.ts)")
		.requiredOption("--grants <path>", "Path to grants definition (grants.ts)")
		.requiredOption("--output <path>", "Output path for version set JSON")
		.option("--git-sha <sha>", "Git SHA (default: from environment or zeroed)")
		.option("--compatibility-date <date>", "Compatibility date (default: 2025-05-01)")
		.action(action_artifacts_upload);

	const runs = pipelines.command("runs").description("Manage pipeline runs");

	runs.command("start")
		.description("Start a pipeline run with an explicit version set")
		.requiredOption("--package <name>", "Package name")
		.requiredOption("--version-set-id <id>", "Version set ID from corpus")
		.action(action_runs_start(client_factory));

	return pipelines;
};
