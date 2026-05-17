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
import { selectCorpusBackend, type CorpusBackendMode } from "../corpus-backend.ts";
import { upload_blob_to_store, upload_version_set } from "../corpus-http-backend.ts";
import {
	type ArtifactInputs,
	type CompileError,
	type VersionSetOutput,
	build_manifest,
	compile_pipeline_ts,
	compile_template_to_json,
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
	orchestratorUrl?: string;
	token?: string;
	mode?: string;
}

const resolve_mode = (options: ArtifactsUploadOptions): { mode: CorpusBackendMode; pipelines_url: string | undefined; pipelines_token: string | undefined } => {
	const explicit = options.mode === "memory" || options.mode === "cloudflare-http" ? (options.mode as CorpusBackendMode) : undefined;
	const url = options.orchestratorUrl ?? process.env.DEVPAD_PIPELINES_URL;
	const token = options.token ?? process.env.DEVPAD_PIPELINES_TOKEN;
	const mode: CorpusBackendMode = explicit ?? (url !== undefined && url !== "" && token !== undefined && token !== "" ? "cloudflare-http" : "memory");
	return { mode, pipelines_url: url, pipelines_token: token };
};

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

	const resolved = resolve_mode(options);

	// In HTTP mode we upload each blob through `/artifacts/blob` and use
	// the server-assigned `<store_id>/<content_hash>` refs in the
	// manifest. In memory mode we keep the legacy short-hash refs so the
	// existing CI/test scripts that snapshot the manifest output stay
	// stable.
	let bundle_ref: string;
	let manifest_ref: string;
	let infra_plan_ref: string;
	let pipeline_ref: string;
	let grants_ref: string;

	if (resolved.mode === "cloudflare-http") {
		if (resolved.pipelines_url === undefined || resolved.pipelines_token === undefined) {
			return fail_with(spinner, "cloudflare-http mode requires --orchestrator-url + --token (or DEVPAD_PIPELINES_URL + DEVPAD_PIPELINES_TOKEN)");
		}
		const http_input = { pipelines_url: resolved.pipelines_url, pipelines_token: resolved.pipelines_token };
		const refs = await upload_blobs_http(http_input, { bundle, manifest_text, infra_plan, pipeline, grants });
		if (!refs.ok) return fail_with(spinner, refs.error);
		bundle_ref = refs.value.bundle_ref;
		manifest_ref = refs.value.manifest_ref;
		infra_plan_ref = refs.value.infra_plan_ref;
		pipeline_ref = refs.value.pipeline_ref;
		grants_ref = refs.value.grants_ref;
	} else {
		bundle_ref = `worker-bundles/${compute_hash(bundle).slice(0, 12)}`;
		manifest_ref = `env-manifests/${compute_hash(Buffer.from(manifest_text)).slice(0, 12)}`;
		infra_plan_ref = `infra-plans/${compute_hash(infra_plan).slice(0, 12)}`;
		pipeline_ref = `pipelines/${compute_hash(pipeline).slice(0, 12)}`;
		grants_ref = `grants/${compute_hash(grants).slice(0, 12)}`;
	}

	// Compile pipeline.ts → JSON snapshot, upload to the pipeline-templates
	// store (HTTP mode only — memory mode keeps the legacy manifest shape
	// stable for the existing snapshot-based golden tests), and capture
	// the assigned ref to embed in the version-set manifest.
	let template_ref: string | undefined;
	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const template_upload = await compile_and_upload_template(http_input, options.pipeline);
		if (!template_upload.ok) return fail_with(spinner, template_upload.error);
		template_ref = template_upload.value;
	}

	const artifacts = {
		bundle,
		bundle_ref,
		manifest: manifest_obj,
		manifest_ref,
		infra_plan,
		infra_plan_ref,
		pipeline,
		pipeline_ref,
		grants,
		grants_ref,
		template_ref,
	};

	const manifest_result = build_manifest(inputs, artifacts);
	if (!manifest_result.ok) return fail_with(spinner, manifest_result.error.message);

	let version_set_id: string;

	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const upload = await upload_version_set(http_input, manifest_result.value);
		if (!upload.ok) {
			return fail_with(spinner, `version-set upload failed: ${format_http_error(upload.error)}`);
		}
		version_set_id = upload.value.version_set_id;
	} else {
		const backend = await selectCorpusBackend({ mode: "memory" });
		const { version_set_store } = await import("@f0rbit/corpus");
		const version_sets = version_set_store(backend);
		const put_result = await version_sets.put(manifest_result.value);
		if (!put_result.ok) {
			const error_msg = put_result.error.kind === "storage_error" ? put_result.error.cause?.message || "Storage error" : "Failed to store manifest";
			return fail_with(spinner, error_msg);
		}
		version_set_id = put_result.value.version;
	}

	const output: VersionSetOutput = {
		id: version_set_id,
		version: version_set_id,
		package: inputs.package_name,
	};

	writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
	spinner.succeed("Artifacts uploaded successfully");
	console.log(chalk.green(`Version Set ID: ${version_set_id}`));
};

const format_http_error = (e: { kind: string; status?: number; status_text?: string; cause?: unknown; message?: string }): string => {
	if (e.kind === "http") return `HTTP ${e.status} ${e.status_text}`;
	if (e.kind === "network") return `network error: ${String(e.cause)}`;
	return e.message ?? "unknown error";
};

type HttpUploadInput = { pipelines_url: string; pipelines_token: string };
type BlobInputs = { bundle: Buffer; manifest_text: string; infra_plan: Buffer; pipeline: Buffer; grants: Buffer };
type BlobRefs = { bundle_ref: string; manifest_ref: string; infra_plan_ref: string; pipeline_ref: string; grants_ref: string };

const upload_blobs_http = async (input: HttpUploadInput, blobs: BlobInputs): Promise<{ ok: true; value: BlobRefs } | { ok: false; error: string }> => {
	const pairs: Array<{ key: keyof BlobRefs; store: string; bytes: Uint8Array }> = [
		{ key: "bundle_ref", store: "worker-bundles", bytes: to_u8(blobs.bundle) },
		{ key: "manifest_ref", store: "env-manifests", bytes: new TextEncoder().encode(blobs.manifest_text) },
		{ key: "infra_plan_ref", store: "infra-plans", bytes: to_u8(blobs.infra_plan) },
		{ key: "pipeline_ref", store: "pipelines", bytes: to_u8(blobs.pipeline) },
		{ key: "grants_ref", store: "grants", bytes: to_u8(blobs.grants) },
	];
	const out: Partial<BlobRefs> = {};
	for (const { key, store, bytes } of pairs) {
		const upload = await upload_blob_to_store(input, store, bytes);
		if (!upload.ok) return { ok: false, error: `${store} upload failed: ${format_http_error(upload.error)}` };
		out[key] = upload.value.ref;
	}
	return { ok: true, value: out as BlobRefs };
};

const to_u8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

const format_compile_error = (e: CompileError): string => {
	if (e.kind === "build_failed") return `pipeline.ts build failed: ${e.message}`;
	if (e.kind === "import_failed") return `pipeline.ts import failed: ${e.message}`;
	if (e.kind === "not_a_template") return `pipeline.ts not a template: ${e.message}`;
	return `pipeline.ts DSL error: ${JSON.stringify(e.cause)}`;
};

/**
 * Compile a `pipeline.ts` into a serialised PipelineTemplate JSON, upload
 * the bytes to the `pipeline-templates` corpus store, and return the
 * server-assigned `<store_id>/<content_hash>` ref. The ref is later
 * embedded on the version-set manifest as `template_ref` so the
 * orchestrator can rehydrate the typed template at run start.
 */
const compile_and_upload_template = async (
	http_input: HttpUploadInput,
	pipeline_path: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> => {
	const compiled = await compile_pipeline_ts(pipeline_path);
	if (!compiled.ok) return { ok: false, error: format_compile_error(compiled.error) };

	const json = compile_template_to_json(compiled.value);
	if (!json.ok) return { ok: false, error: format_compile_error(json.error) };

	const bytes = new TextEncoder().encode(json.value);
	const upload = await upload_blob_to_store(http_input, "pipeline-templates", bytes);
	if (!upload.ok) return { ok: false, error: `pipeline-templates upload failed: ${format_http_error(upload.error)}` };
	return { ok: true, value: upload.value.ref };
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
		.option("--orchestrator-url <url>", "Orchestrator base URL (default: $DEVPAD_PIPELINES_URL)")
		.option("--token <token>", "Bearer token (default: $DEVPAD_PIPELINES_TOKEN)")
		.option("--mode <mode>", "Backend mode: memory | cloudflare-http (default: auto)")
		.action(action_artifacts_upload);

	const runs = pipelines.command("runs").description("Manage pipeline runs");

	runs.command("start")
		.description("Start a pipeline run with an explicit version set")
		.requiredOption("--package <name>", "Package name")
		.requiredOption("--version-set-id <id>", "Version set ID from corpus")
		.action(action_runs_start(client_factory));

	return pipelines;
};
