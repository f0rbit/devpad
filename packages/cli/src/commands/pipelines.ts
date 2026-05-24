/**
 * @module @devpad/cli/commands/pipelines
 *
 * `devpad pipelines …` subcommand group: `init`, `runs start`, `approve`,
 * `cancel`, `rollback`, `artifacts upload`. `init` shells out to the scaffolder;
 * the others wrap `client.pipelines.*` so we never re-implement HTTP plumbing.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { type ApiClient, ApiClient as ApiClientCtor } from "@devpad/api";
import { derive_template_vars, render_template as render_pkg_template, SCAFFOLDER_TEMPLATES } from "@devpad/pipeline-templates";
import type { VersionSetManifest } from "@f0rbit/corpus";
import chalk from "chalk";
import type { Command } from "commander";
import { type AssetWalkError, type WalkedAssets, walk_assets_dir } from "../asset-walker.ts";
import { type BundleWalkError, type WalkedBundle, walk_bundle_dir } from "../bundle-walker.ts";
import { type CorpusBackendMode, selectCorpusBackend } from "../corpus-backend.ts";
import { upload_blob_to_store, upload_version_set } from "../corpus-http-backend.ts";
import {
	type ArtifactInputs,
	build_asset_manifest_from_walk,
	build_bundle_manifest_from_walk,
	build_manifest,
	type CompileError,
	compile_pipeline_ts,
	compile_template_to_json,
	compute_hash,
	type VersionSetOutput,
	validate_artifact_paths,
} from "../pipelines-artifacts-helpers.ts";
import { fail_with, make_spinner, print_next_steps as print_next_steps_shared } from "../printer.ts";
import { type ScaffolderError, scaffold_package } from "../scaffolder/index.ts";
import type { DefaultGateKind, RolloutMode } from "../scaffolder/types.ts";

const ROLLOUT_MODES = ["gradual", "atomic"] as const;
const GATE_KINDS = ["manual", "auto", "analysis"] as const;
const BUILD_SHAPES = ["single-file", "directory-bundle"] as const;

const is_rollout_mode = (s: string): s is RolloutMode => (ROLLOUT_MODES as readonly string[]).includes(s);
const is_gate_kind = (s: string): s is DefaultGateKind => (GATE_KINDS as readonly string[]).includes(s);
const is_build_shape = (s: string): s is (typeof BUILD_SHAPES)[number] => (BUILD_SHAPES as readonly string[]).includes(s);

const format_scaffolder_error = (e: ScaffolderError): string => {
	if (e.code === "render_failed") return `${e.message}\n  variable: ${e.cause.var}\n  near: ${e.cause.template_snippet}`;
	if (e.code === "target_exists") return `${e.message}\n  remove it or pass --dir to a fresh path`;
	return e.message;
};

const print_next_steps = (target_dir: string, package_name: string, rollout: RolloutMode): void => {
	const rel = path.relative(process.cwd(), target_dir) || ".";
	print_next_steps_shared(
		`✓ Scaffolded ${package_name} at ${target_dir}`,
		[
			{ command: `cd ${rel}` },
			{ command: "bun dev                           ", comment: "local wrangler dev" },
			{ command: "devpad pipelines runs start       ", comment: `trigger a ${rollout} pipeline run` },
			{ command: "devpad pipelines approve <run-id> <stage>" },
		],
		'Read AGENTS.md for hard rules — esp. "don\'t deploy manually".'
	);
};

export const action_init = async (name: string, options: { rollout: string; defaultGate: string; buildShape: string; dir?: string; skipInstall?: boolean; skipGit?: boolean }): Promise<void> => {
	const spinner = make_spinner(`Scaffolding ${name}...`).start();

	if (!is_rollout_mode(options.rollout)) return fail_with(spinner, `--rollout must be one of ${ROLLOUT_MODES.join(", ")}; got "${options.rollout}"`);
	if (!is_gate_kind(options.defaultGate)) return fail_with(spinner, `--default-gate must be one of ${GATE_KINDS.join(", ")}; got "${options.defaultGate}"`);
	if (!is_build_shape(options.buildShape)) return fail_with(spinner, `--build-shape must be one of ${BUILD_SHAPES.join(", ")}; got "${options.buildShape}"`);

	const target_dir = path.resolve(options.dir ?? path.join(process.cwd(), name));

	const result = await scaffold_package({
		package_name: name,
		target_dir,
		rollout: options.rollout,
		default_gate: options.defaultGate,
		build_shape: options.buildShape as (typeof BUILD_SHAPES)[number],
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

const action_approve =
	(client_factory: ClientFactory) =>
	async (run_id: string, stage: string, options: { user?: string; reason?: string }): Promise<void> => {
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

const action_cancel =
	(client_factory: ClientFactory) =>
	async (run_id: string): Promise<void> => {
		const spinner = make_spinner(`Cancelling ${run_id}...`).start();
		const client = client_factory();
		const result = await client.pipelines.cancel(run_id);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`cancelled ${run_id}`);
	};

const action_rollback =
	(client_factory: ClientFactory) =>
	async (run_id: string): Promise<void> => {
		const spinner = make_spinner(`Rolling back ${run_id}...`).start();
		const client = client_factory();
		const result = await client.pipelines.rollback(run_id);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`rolled back ${run_id}`);
	};

const action_grants_list =
	(client_factory: ClientFactory) =>
	async (options: { package: string }): Promise<void> => {
		const spinner = make_spinner(`Listing grants for ${options.package}...`).start();
		const client = client_factory();
		const result = await client.pipelines.grants.list(options.package);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`${result.value.length} grant(s)`);
		for (const g of result.value) {
			const granted_at = g.granted_at ?? chalk.dim("pending");
			console.log(`  ${chalk.bold(g.id)}  ${g.stage_name}  ${chalk.cyan(g.scope)}  ${granted_at}`);
		}
	};

const action_grants_approve =
	(client_factory: ClientFactory) =>
	async (grant_id: string, options: { user?: string }): Promise<void> => {
		const spinner = make_spinner(`Approving grant ${grant_id}...`).start();
		const user_id = options.user ?? process.env.DEVPAD_USER_ID;
		if (user_id === undefined) return fail_with(spinner, "--user required (or DEVPAD_USER_ID env var)");
		const client = client_factory();
		const result = await client.pipelines.grants.approve(grant_id, user_id);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`approved grant ${grant_id}`);
	};

const action_grants_deny =
	(client_factory: ClientFactory) =>
	async (grant_id: string, options: { user?: string; reason?: string }): Promise<void> => {
		const spinner = make_spinner(`Denying grant ${grant_id}...`).start();
		const user_id = options.user ?? process.env.DEVPAD_USER_ID;
		if (user_id === undefined) return fail_with(spinner, "--user required (or DEVPAD_USER_ID env var)");
		const client = client_factory();
		const result = await client.pipelines.grants.deny(grant_id, user_id, options.reason);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`denied grant ${grant_id}`);
	};

interface ArtifactsUploadOptions {
	package: string;
	/** Legacy single-file Worker bundle path. Mutually exclusive with `bundleDir`. */
	bundle?: string;
	/** Directory-bundle Worker path (e.g. `dist/_worker.js/`). Mutually exclusive with `bundle`. */
	bundleDir?: string;
	/** Entrypoint module name (e.g. `"index.js"`). Required when `--bundle-dir` is set. */
	mainModule?: string;
	/** Static-asset directory (e.g. `dist/`). When set, all files are uploaded as CF assets. */
	assetsDir?: string;
	/** Path to JSON file OR inline JSON string for asset config (`html_handling`, `not_found_handling`, `run_worker_first`). */
	assetConfig?: string;
	/** Optional env manifest JSON path. Defaults to `{}` when absent. */
	manifest?: string;
	infraPlan: string;
	pipeline: string;
	grants: string;
	output: string;
	gitSha?: string;
	compatibilityDate?: string;
	compatibilityFlag?: string[];
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

	if (options.bundle !== undefined && options.bundleDir !== undefined) {
		return fail_with(spinner, "--bundle and --bundle-dir are mutually exclusive");
	}
	if (options.bundle === undefined && options.bundleDir === undefined) {
		return fail_with(spinner, "either --bundle or --bundle-dir is required");
	}
	if (options.bundleDir !== undefined && (options.mainModule === undefined || options.mainModule.trim() === "")) {
		return fail_with(spinner, "--main-module is required when --bundle-dir is supplied");
	}

	const inputs: ArtifactInputs = {
		package_name: options.package,
		bundle_path: options.bundle,
		bundle_dir_path: options.bundleDir,
		manifest_path: options.manifest,
		infra_plan_path: options.infraPlan,
		pipeline_path: options.pipeline,
		grants_path: options.grants,
		git_sha: options.gitSha,
		compatibility_date: options.compatibilityDate,
	};

	const validation_result = validate_artifact_paths(inputs);
	if (!validation_result.ok) return fail_with(spinner, validation_result.error.message);

	const compatibility_date = options.compatibilityDate ?? "2025-05-01";
	const compatibility_flags = options.compatibilityFlag ?? [];

	// Env manifest is optional in directory mode (Astro/Remix builds may
	// not emit `dist/manifest.json`). Single-file mode keeps the historical
	// requirement of a file path so existing tests continue to exercise
	// the same code path.
	let manifest_text = "{}";
	if (options.manifest !== undefined && options.manifest !== "") {
		manifest_text = readFileSync(options.manifest, "utf8");
	}
	const manifest_obj = JSON.parse(manifest_text) as object;
	const infra_plan = readFileSync(options.infraPlan);
	const pipeline = readFileSync(options.pipeline);
	const grants = readFileSync(options.grants);

	const resolved = resolve_mode(options);

	if (resolved.mode === "cloudflare-http" && (resolved.pipelines_url === undefined || resolved.pipelines_token === undefined)) {
		return fail_with(spinner, "cloudflare-http mode requires --orchestrator-url + --token (or DEVPAD_PIPELINES_URL + DEVPAD_PIPELINES_TOKEN)");
	}

	// --- Sidecar uploads (env manifest, infra plan, pipeline source, grants) ---
	let manifest_ref: string;
	let infra_plan_ref: string;
	let pipeline_ref: string;
	let grants_ref: string;

	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const refs = await upload_sidecars_http(http_input, { manifest_text, infra_plan, pipeline, grants });
		if (!refs.ok) return fail_with(spinner, refs.error);
		manifest_ref = refs.value.manifest_ref;
		infra_plan_ref = refs.value.infra_plan_ref;
		pipeline_ref = refs.value.pipeline_ref;
		grants_ref = refs.value.grants_ref;
	} else {
		manifest_ref = `env-manifests/${compute_hash(Buffer.from(manifest_text)).slice(0, 12)}`;
		infra_plan_ref = `infra-plans/${compute_hash(infra_plan).slice(0, 12)}`;
		pipeline_ref = `pipelines/${compute_hash(pipeline).slice(0, 12)}`;
		grants_ref = `grants/${compute_hash(grants).slice(0, 12)}`;
	}

	// --- Worker bundle upload (single-file XOR directory-bundle) ---
	let bundle_ref: string | undefined;
	let bundle_manifest_ref: string | undefined;
	let bundle_bytes: Buffer | undefined;
	let bundle_total_size_bytes: number | undefined;

	if (options.bundle !== undefined) {
		bundle_bytes = readFileSync(options.bundle);
		if (resolved.mode === "cloudflare-http") {
			const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
			const u8 = new Uint8Array(bundle_bytes.buffer, bundle_bytes.byteOffset, bundle_bytes.byteLength);
			const upload = await upload_blob_to_store(http_input, "worker-bundles", u8);
			if (!upload.ok) return fail_with(spinner, `worker-bundles upload failed: ${format_http_error(upload.error)}`);
			bundle_ref = upload.value.ref;
		} else {
			bundle_ref = `worker-bundles/${compute_hash(bundle_bytes).slice(0, 12)}`;
		}
	} else {
		const walk = walk_bundle_dir(options.bundleDir!);
		if (!walk.ok) return fail_with(spinner, format_bundle_walk_error(walk.error));
		bundle_total_size_bytes = walk.value.total_size_bytes;

		const main_module = options.mainModule!;
		const has_main = walk.value.parts.some(p => p.name === main_module);
		if (!has_main) {
			return fail_with(spinner, `--main-module "${main_module}" not found in bundle dir; parts: ${walk.value.parts.map(p => p.name).join(", ")}`);
		}

		const directory_refs = await upload_bundle_directory(resolved, walk.value, { compatibility_date, compatibility_flags, main_module });
		if (!directory_refs.ok) return fail_with(spinner, directory_refs.error);
		bundle_manifest_ref = directory_refs.value;
	}

	// --- Static-asset upload (independent of bundle mode) ---
	let asset_manifest_ref: string | undefined;
	if (options.assetsDir !== undefined) {
		// Skip the Worker bundle subtree when both flags are supplied and the
		// bundle dir sits inside the assets dir (the Astro/Remix layout).
		const extra_ignore = derive_bundle_ignore_pattern(options.assetsDir, options.bundleDir);
		const config_result = parse_asset_config(options.assetConfig);
		if (!config_result.ok) return fail_with(spinner, config_result.error);
		const asset_walk = walk_assets_dir(options.assetsDir, { extra_ignore_patterns: extra_ignore });
		if (!asset_walk.ok) return fail_with(spinner, format_asset_walk_error(asset_walk.error));
		const upload = await upload_assets_directory(resolved, asset_walk.value, config_result.value);
		if (!upload.ok) return fail_with(spinner, upload.error);
		asset_manifest_ref = upload.value;
	}

	// --- Pipeline template snapshot (HTTP mode only) ---
	let template_ref: string | undefined;
	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const template_upload = await compile_and_upload_template(http_input, options.pipeline);
		if (!template_upload.ok) return fail_with(spinner, template_upload.error);
		template_ref = template_upload.value;
	}

	const manifest_result = build_manifest(inputs, {
		bundle: bundle_bytes,
		bundle_ref,
		bundle_manifest_ref,
		bundle_total_size_bytes,
		manifest: manifest_obj,
		manifest_ref,
		infra_plan,
		infra_plan_ref,
		pipeline,
		pipeline_ref,
		grants,
		grants_ref,
		template_ref,
		asset_manifest_ref,
	});
	if (!manifest_result.ok) return fail_with(spinner, manifest_result.error.message);

	let version_set_id: string;

	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const upload = await upload_version_set(http_input, manifest_result.value as VersionSetManifest);
		if (!upload.ok) {
			return fail_with(spinner, `version-set upload failed: ${format_http_error(upload.error)}`);
		}
		version_set_id = upload.value.version_set_id;
	} else {
		const backend = await selectCorpusBackend({ mode: "memory" });
		const { version_set_store } = await import("@f0rbit/corpus");
		const version_sets = version_set_store(backend);
		const put_result = await version_sets.put(manifest_result.value as VersionSetManifest);
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

const format_bundle_walk_error = (e: BundleWalkError): string => {
	switch (e.kind) {
		case "not_a_directory":
			return `bundle-dir is not a directory: ${e.path}`;
		case "io_error":
			return `bundle-dir read failed at ${e.path}: ${e.reason}`;
		case "unsupported_extension":
			return `bundle-dir contains unsupported extension "${e.extension}" at ${e.path}; only .js/.mjs/.cjs/.wasm allowed`;
		case "empty_bundle":
			return `bundle-dir is empty: ${e.path}`;
	}
};

const format_asset_walk_error = (e: AssetWalkError): string => {
	switch (e.kind) {
		case "not_a_directory":
			return `assets-dir is not a directory: ${e.path}`;
		case "io_error":
			return `assets-dir read failed at ${e.path}: ${e.reason}`;
		case "asset_too_large":
			return `asset exceeds CF limit (${e.limit_bytes} bytes): ${e.path} is ${e.size_bytes} bytes`;
	}
};

type HttpUploadInput = { pipelines_url: string; pipelines_token: string };
type SidecarInputs = { manifest_text: string; infra_plan: Buffer; pipeline: Buffer; grants: Buffer };
type SidecarRefs = { manifest_ref: string; infra_plan_ref: string; pipeline_ref: string; grants_ref: string };

const upload_sidecars_http = async (input: HttpUploadInput, blobs: SidecarInputs): Promise<{ ok: true; value: SidecarRefs } | { ok: false; error: string }> => {
	const pairs: Array<{ key: keyof SidecarRefs; store: string; bytes: Uint8Array }> = [
		{ key: "manifest_ref", store: "env-manifests", bytes: new TextEncoder().encode(blobs.manifest_text) },
		{ key: "infra_plan_ref", store: "infra-plans", bytes: to_u8(blobs.infra_plan) },
		{ key: "pipeline_ref", store: "pipelines", bytes: to_u8(blobs.pipeline) },
		{ key: "grants_ref", store: "grants", bytes: to_u8(blobs.grants) },
	];
	const out: Partial<SidecarRefs> = {};
	for (const { key, store, bytes } of pairs) {
		const upload = await upload_blob_to_store(input, store, bytes);
		if (!upload.ok) return { ok: false, error: `${store} upload failed: ${format_http_error(upload.error)}` };
		out[key] = upload.value.ref;
	}
	return { ok: true, value: out as SidecarRefs };
};

const to_u8 = (b: Buffer): Uint8Array => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

type ResolvedMode = { mode: CorpusBackendMode; pipelines_url: string | undefined; pipelines_token: string | undefined };

/**
 * Upload every module part to the `worker-modules` corpus store, build a
 * `BundleManifest`, and upload it to the `bundle-manifests` store.
 * Returns the assigned ref for the manifest blob — the field that gets
 * stamped onto the version-set's `builds.worker.bundle_manifest_ref`.
 *
 * In memory mode the refs are deterministic short-hashes (mirrors the
 * legacy `worker-bundles/...` format) so the existing snapshot-based
 * golden tests stay stable. Memory mode also short-circuits the upload
 * to corpus since callers in memory mode never read the directory bundle
 * back.
 */
const upload_bundle_directory = async (
	resolved: ResolvedMode,
	walk: WalkedBundle,
	build: { compatibility_date: string; compatibility_flags: string[]; main_module: string }
): Promise<{ ok: true; value: string } | { ok: false; error: string }> => {
	const module_refs: string[] = [];
	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		for (const part of walk.parts) {
			const upload = await upload_blob_to_store(http_input, "worker-modules", part.bytes);
			if (!upload.ok) return { ok: false, error: `worker-modules upload failed for ${part.name}: ${format_http_error(upload.error)}` };
			module_refs.push(upload.value.ref);
		}
	} else {
		for (const part of walk.parts) {
			module_refs.push(`worker-modules/${compute_hash(Buffer.from(part.bytes)).slice(0, 12)}`);
		}
	}

	const manifest = build_bundle_manifest_from_walk(walk, module_refs, build.main_module, build.compatibility_date, build.compatibility_flags);
	if (!manifest.ok) return { ok: false, error: manifest.error.message };

	const manifest_bytes = new TextEncoder().encode(JSON.stringify(manifest.value));
	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const upload = await upload_blob_to_store(http_input, "bundle-manifests", manifest_bytes);
		if (!upload.ok) return { ok: false, error: `bundle-manifests upload failed: ${format_http_error(upload.error)}` };
		return { ok: true, value: upload.value.ref };
	}
	return { ok: true, value: `bundle-manifests/${compute_hash(Buffer.from(manifest_bytes)).slice(0, 12)}` };
};

const upload_assets_directory = async (resolved: ResolvedMode, walk: WalkedAssets, config: object): Promise<{ ok: true; value: string } | { ok: false; error: string }> => {
	const asset_refs: string[] = [];
	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		for (const part of walk.parts) {
			const upload = await upload_blob_to_store(http_input, "asset-files", part.bytes);
			if (!upload.ok) return { ok: false, error: `asset-files upload failed for ${part.path}: ${format_http_error(upload.error)}` };
			asset_refs.push(upload.value.ref);
		}
	} else {
		for (const part of walk.parts) {
			asset_refs.push(`asset-files/${compute_hash(Buffer.from(part.bytes)).slice(0, 12)}`);
		}
	}

	const manifest = build_asset_manifest_from_walk(walk, asset_refs, config);
	if (!manifest.ok) return { ok: false, error: manifest.error.message };

	const manifest_bytes = new TextEncoder().encode(JSON.stringify(manifest.value));
	if (resolved.mode === "cloudflare-http") {
		const http_input = { pipelines_url: resolved.pipelines_url!, pipelines_token: resolved.pipelines_token! };
		const upload = await upload_blob_to_store(http_input, "asset-manifests", manifest_bytes);
		if (!upload.ok) return { ok: false, error: `asset-manifests upload failed: ${format_http_error(upload.error)}` };
		return { ok: true, value: upload.value.ref };
	}
	return { ok: true, value: `asset-manifests/${compute_hash(Buffer.from(manifest_bytes)).slice(0, 12)}` };
};

const parse_asset_config = (raw: string | undefined): { ok: true; value: object } | { ok: false; error: string } => {
	if (raw === undefined || raw === "") return { ok: true, value: {} };
	// Accept either an inline JSON string OR a path to a JSON file. The
	// heuristic: if the value parses as JSON we trust it; otherwise we
	// `readFileSync` and re-parse. Either failure mode surfaces a clear
	// error.
	const try_parse = (text: string): object | null => {
		try {
			const parsed = JSON.parse(text) as unknown;
			return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as object) : null;
		} catch {
			return null;
		}
	};
	const inline = try_parse(raw);
	if (inline !== null) return { ok: true, value: inline };
	let file_text: string;
	try {
		file_text = readFileSync(raw, "utf8");
	} catch (e) {
		return { ok: false, error: `--asset-config is neither valid JSON nor a readable file path: ${raw}` };
	}
	const from_file = try_parse(file_text);
	if (from_file === null) return { ok: false, error: `--asset-config file does not contain a JSON object: ${raw}` };
	return { ok: true, value: from_file };
};

/**
 * Build an extra-ignore pattern that excludes the Worker bundle subtree
 * when the bundle dir lives inside the assets dir (Astro/Remix layout
 * where `dist/_worker.js/` is a sibling of `dist/_astro/`). Returns an
 * empty list when the bundle dir is outside the assets dir or absent.
 */
const derive_bundle_ignore_pattern = (assets_dir: string, bundle_dir: string | undefined): string[] => {
	if (bundle_dir === undefined) return [];
	let assets_real: string;
	let bundle_real: string;
	try {
		assets_real = statSync(assets_dir).isDirectory() ? path.resolve(assets_dir) : assets_dir;
		bundle_real = statSync(bundle_dir).isDirectory() ? path.resolve(bundle_dir) : bundle_dir;
	} catch {
		return [];
	}
	const rel = path.relative(assets_real, bundle_real);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return [];
	const posix_rel = rel.split(path.sep).join("/");
	// Match the bundle dir AND everything under it. gitignore-style
	// `dir/**` covers descendant files; a separate `dir` line covers the
	// directory itself (and any direct children matched by gitignore's
	// dir-as-glob semantics).
	return [posix_rel, `${posix_rel}/**`];
};

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
const compile_and_upload_template = async (http_input: HttpUploadInput, pipeline_path: string): Promise<{ ok: true; value: string } | { ok: false; error: string }> => {
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

const action_runs_start =
	(client_factory: ClientFactory) =>
	async (options: RunsStartOptions): Promise<void> => {
		const spinner = make_spinner("Starting pipeline run...").start();
		const client = client_factory();
		const result = await client.pipelines.create({ package_id: options.package, version_set_id: options.versionSetId });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`run ${result.value.run_id} (${result.value.status})`);
		console.log(chalk.green(`Run ID: ${result.value.run_id}`));
	};

// ─── runs events subcommand actions (Phase 2.C) ────────────────────
//
// `events ingest` posts a webhook event for a run; `events list` reads
// them back. CLI uses the admin bearer (literal PIPELINES_TOKEN via the
// HttpClient's auth header injection) — external CI uses session JWTs
// via direct HTTP, not the CLI.

interface EventsIngestOptions {
	stage: string;
	kind: string;
	payloadFile?: string;
	idempotencyKey?: string;
}

const STAGE_EVENT_KINDS = ["deploy_started", "deploy_completed", "bake_started", "bake_completed", "gate_verdict", "approval_requested", "rollback_started", "rollback_completed", "warning", "error"] as const;
type StageEventKindLocal = (typeof STAGE_EVENT_KINDS)[number];
const is_stage_event_kind = (s: string): s is StageEventKindLocal => (STAGE_EVENT_KINDS as readonly string[]).includes(s);

const action_runs_events_ingest =
	(client_factory: ClientFactory) =>
	async (run_id: string, options: EventsIngestOptions): Promise<void> => {
		const spinner = make_spinner(`Ingesting event into ${run_id}...`).start();

		if (!is_stage_event_kind(options.kind)) {
			return fail_with(spinner, `--kind must be one of ${STAGE_EVENT_KINDS.join(", ")}; got "${options.kind}"`);
		}

		let payload: unknown;
		if (options.payloadFile !== undefined) {
			if (!existsSync(options.payloadFile)) return fail_with(spinner, `--payload-file not found: ${options.payloadFile}`);
			const text = readFileSync(options.payloadFile, "utf8");
			try {
				payload = JSON.parse(text);
			} catch (e) {
				return fail_with(spinner, `--payload-file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
			}
		}

		let idempotency_key = options.idempotencyKey;
		if (idempotency_key === undefined || idempotency_key === "") {
			idempotency_key = crypto.randomUUID();
			console.error(chalk.yellow(`warning: no --idempotency-key supplied; generated ${idempotency_key} (non-replayable across CLI invocations)`));
		}

		const client = client_factory();
		const result = await client.pipelines.events.ingest(run_id, {
			stage_name: options.stage,
			kind: options.kind,
			payload,
			idempotency_key,
		});
		if (!result.ok) return fail_with(spinner, result.error.message);
		const label = result.value.duplicated ? "replayed (existing)" : "inserted";
		spinner.succeed(`${label} event ${result.value.event_id}`);
	};

const action_runs_events_list =
	(client_factory: ClientFactory) =>
	async (run_id: string): Promise<void> => {
		const spinner = make_spinner(`Listing events for ${run_id}...`).start();
		const client = client_factory();
		const result = await client.pipelines.events.list(run_id);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`${result.value.length} event(s)`);
		for (const ev of result.value) {
			console.log(`  ${chalk.dim(ev.ts)}  ${chalk.cyan(ev.kind)}  ${ev.stage_name}  ${chalk.dim(ev.id)}`);
		}
	};

// ─── packages subcommand actions ───────────────────────────────────
//
// `packages list / get / create / update / delete` wrap the API client
// methods added in Phase 14. `create` resolves `--owner-id` from
// `client.auth.session()` (whoami) when not supplied and maps
// `--project <slug>` → `project_id` via `client.projects.list()` so the
// user supplies the human-readable slug instead of memorising the
// internal id.

export interface PackagesListOptions {
	project?: string;
}

export const action_packages_list =
	(client_factory: ClientFactory) =>
	async (options: PackagesListOptions): Promise<void> => {
		const spinner = make_spinner("Listing pipeline packages...").start();
		const client = client_factory();
		const filter = options.project !== undefined ? { project_id: await resolve_project_id(client, options.project) } : undefined;
		if (filter !== undefined && filter.project_id === null) return fail_with(spinner, `project "${options.project}" not found`);

		const result = await client.pipelines.packages.list(filter as { project_id?: string } | undefined);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`${result.value.length} package(s)`);
		for (const p of result.value) {
			const project_label = p.project_id ?? chalk.dim("(unlinked)");
			const repo_label = p.repo_url ?? chalk.dim("(no repo)");
			console.log(`  ${chalk.bold(p.id)}  ${chalk.cyan(p.name)}  ${project_label}  ${repo_label}`);
		}
	};

export const action_packages_get =
	(client_factory: ClientFactory) =>
	async (id: string): Promise<void> => {
		const spinner = make_spinner(`Fetching ${id}...`).start();
		const client = client_factory();
		const result = await client.pipelines.packages.get(id);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`${result.value.id}`);
		console.log(JSON.stringify(result.value, null, 2));
	};

export interface PackagesCreateOptions {
	name?: string;
	ownerId?: string;
	project?: string;
	repoUrl?: string;
}

export const action_packages_create =
	(client_factory: ClientFactory) =>
	async (name_arg: string | undefined, options: PackagesCreateOptions): Promise<void> => {
		const name = name_arg ?? options.name;
		if (name === undefined || name === "") {
			console.error(chalk.red("error: positional <name> (or --name) is required"));
			process.exit(1);
		}
		const spinner = make_spinner(`Registering ${name}...`).start();
		const client = client_factory();

		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		let project_id: string | null | undefined;
		if (options.project !== undefined) {
			const resolved = await resolve_project_id(client, options.project);
			if (resolved === null) return fail_with(spinner, `project "${options.project}" not found`);
			project_id = resolved;
		}

		const result = await client.pipelines.packages.create({
			id: name,
			name,
			owner_id,
			repo_url: options.repoUrl,
			project_id,
		});
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`registered ${result.value.id}`);
		console.log(chalk.green(`  id:         ${result.value.id}`));
		console.log(`  name:       ${result.value.name}`);
		console.log(`  project_id: ${result.value.project_id ?? "(unlinked)"}`);
		console.log(`  repo_url:   ${result.value.repo_url ?? "(none)"}`);
	};

export interface PackagesUpdateOptions {
	project?: string;
	repoUrl?: string;
	scriptNameOverrides?: string;
}

export const action_packages_update =
	(client_factory: ClientFactory) =>
	async (id: string, options: PackagesUpdateOptions): Promise<void> => {
		const spinner = make_spinner(`Updating ${id}...`).start();
		const client = client_factory();
		const patch: Record<string, unknown> = {};
		if (options.repoUrl !== undefined) patch.repo_url = options.repoUrl;
		if (options.project !== undefined) {
			const resolved = await resolve_project_id(client, options.project);
			if (resolved === null) return fail_with(spinner, `project "${options.project}" not found`);
			patch.project_id = resolved;
		}
		if (options.scriptNameOverrides !== undefined) {
			try {
				patch.script_name_overrides = JSON.parse(options.scriptNameOverrides);
			} catch (e) {
				return fail_with(spinner, `--script-name-overrides is not valid JSON: ${String(e)}`);
			}
		}
		if (Object.keys(patch).length === 0) return fail_with(spinner, "no updates supplied (pass --project, --repo-url, or --script-name-overrides)");

		const result = await client.pipelines.packages.update(id, patch);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`updated ${result.value.id}`);
	};

export interface PackagesDeleteOptions {
	force?: boolean;
}

export const action_packages_delete =
	(client_factory: ClientFactory) =>
	async (id: string, _options: PackagesDeleteOptions): Promise<void> => {
		// `--force` is accepted but is purely a confirmation toggle; the
		// orchestrator still 409s on active runs (we never cascade).
		const spinner = make_spinner(`Deleting ${id}...`).start();
		const client = client_factory();
		const result = await client.pipelines.packages.delete(id);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`deleted ${id}`);
	};

// ─── oidc-trust subcommand actions ─────────────────────────────────
//
// `oidc-trust list / add / remove / show` manage the
// `pipeline_oidc_trust` policies that gate the GitHub Actions OIDC
// exchange (Phase 15). `add` prompts interactively when stdin is a
// TTY, otherwise falls back to flags. Required flag in scripted mode:
// `--owner <gh-owner>`. Sensible defaults are documented in the help
// strings and in plan §I.5.

const split_csv = (value: string | undefined): string[] | undefined => {
	if (value === undefined || value === "") return undefined;
	return value
		.split(",")
		.map(s => s.trim())
		.filter(s => s.length > 0);
};

const prompt_if_tty = async (question: string, fallback?: string): Promise<string> => {
	if (!process.stdin.isTTY) return fallback ?? "";
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const suffix = fallback !== undefined && fallback !== "" ? ` [${fallback}]: ` : ": ";
	const answer = (await rl.question(`${question}${suffix}`)).trim();
	rl.close();
	if (answer === "" && fallback !== undefined) return fallback;
	return answer;
};

const confirm_if_tty = async (question: string): Promise<boolean> => {
	if (!process.stdin.isTTY) return true;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = (await rl.question(`${question} (y/N): `)).trim().toLowerCase();
	rl.close();
	return answer === "y" || answer === "yes";
};

export interface OidcTrustListOptions {
	ownerId?: string;
}

export const action_oidc_trust_list =
	(client_factory: ClientFactory) =>
	async (options: OidcTrustListOptions): Promise<void> => {
		const spinner = make_spinner("Listing OIDC trust policies...").start();
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const result = await client.pipelines.oidc_trust.list({ owner_id });
		if (!result.ok) return fail_with(spinner, result.error.message);

		spinner.succeed(`${result.value.length} policy(ies)`);
		if (result.value.length === 0) {
			console.log(chalk.dim("  no policies — run `pipelines oidc-trust add` to create one"));
			return;
		}
		for (const p of result.value) {
			const refs_label = p.allowed_refs && p.allowed_refs.length > 0 ? p.allowed_refs.join(",") : chalk.dim("any");
			const envs_label = p.allowed_environments && p.allowed_environments.length > 0 ? p.allowed_environments.join(",") : chalk.dim("any");
			const last_used = p.last_used_at ?? chalk.dim("(never)");
			console.log(`  ${chalk.bold(p.id)}`);
			console.log(`    owner:        ${chalk.cyan(p.github_owner)}/${p.repo_pattern}`);
			console.log(`    aud:          ${p.expected_audience}`);
			console.log(`    actions:      ${(p.allowed_actions ?? []).join(",")}`);
			console.log(`    refs:         ${refs_label}`);
			console.log(`    environments: ${envs_label}`);
			console.log(`    ttl:          ${p.session_ttl_seconds}s`);
			console.log(`    last_used:    ${last_used}`);
		}
	};

export interface OidcTrustShowOptions {
	ownerId?: string;
}

export const action_oidc_trust_show =
	(client_factory: ClientFactory) =>
	async (id: string, options: OidcTrustShowOptions): Promise<void> => {
		const spinner = make_spinner(`Fetching ${id}...`).start();
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const result = await client.pipelines.oidc_trust.get(id, { owner_id });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(result.value.id);
		console.log(JSON.stringify(result.value, null, 2));
	};

export interface OidcTrustAddOptions {
	owner?: string;
	ownerId?: string;
	repoPattern?: string;
	aud?: string;
	actions?: string;
	refs?: string;
	environments?: string;
	ttl?: string;
}

export const action_oidc_trust_add =
	(client_factory: ClientFactory) =>
	async (options: OidcTrustAddOptions): Promise<void> => {
		const client = client_factory();

		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) {
			console.error(chalk.red("error: could not resolve owner_id from session; set $DEVPAD_USER_ID or pass --owner-id"));
			process.exit(1);
		}

		const github_owner = options.owner ?? (await prompt_if_tty("GitHub owner (e.g. f0rbit)"));
		if (github_owner === "") {
			console.error(chalk.red("error: --owner <gh-owner> is required"));
			process.exit(1);
		}

		const default_aud = "https://devpad-pipelines.dev-818.workers.dev";
		const expected_audience = options.aud ?? (await prompt_if_tty("Expected audience", default_aud));
		if (expected_audience === "") {
			console.error(chalk.red("error: --aud <orchestrator-url> is required"));
			process.exit(1);
		}

		const repo_pattern = options.repoPattern ?? (process.stdin.isTTY ? await prompt_if_tty("Repo pattern", "*") : "*");
		const actions = split_csv(options.actions) ?? (process.stdin.isTTY ? split_csv(await prompt_if_tty("Allowed actions (comma-sep)", "artifacts:upload,runs:start")) : ["artifacts:upload", "runs:start"]);
		const refs = split_csv(options.refs);
		const environments = split_csv(options.environments);
		const ttl = options.ttl !== undefined ? Number.parseInt(options.ttl, 10) : undefined;
		if (options.ttl !== undefined && (!Number.isInteger(ttl) || (ttl ?? -1) <= 0)) {
			console.error(chalk.red(`error: --ttl must be a positive integer, got "${options.ttl}"`));
			process.exit(1);
		}

		const spinner = make_spinner(`Registering trust policy for ${github_owner}...`).start();
		const result = await client.pipelines.oidc_trust.create({
			owner_id,
			github_owner,
			expected_audience,
			repo_pattern,
			allowed_actions: actions ?? undefined,
			allowed_refs: refs,
			allowed_environments: environments,
			session_ttl_seconds: ttl,
		});
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`created ${result.value.id}`);
		console.log(chalk.green(`  id:           ${result.value.id}`));
		console.log(`  github_owner: ${result.value.github_owner}`);
		console.log(`  repo_pattern: ${result.value.repo_pattern}`);
		console.log(`  aud:          ${result.value.expected_audience}`);
		console.log(`  actions:      ${(result.value.allowed_actions ?? []).join(",")}`);
		console.log(`  ttl:          ${result.value.session_ttl_seconds}s`);
	};

export interface OidcTrustRemoveOptions {
	ownerId?: string;
	yes?: boolean;
}

export const action_oidc_trust_remove =
	(client_factory: ClientFactory) =>
	async (id: string, options: OidcTrustRemoveOptions): Promise<void> => {
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) {
			console.error(chalk.red("error: could not resolve owner_id from session; set $DEVPAD_USER_ID or pass --owner-id"));
			process.exit(1);
		}

		if (options.yes !== true) {
			const confirmed = await confirm_if_tty(`Remove trust policy ${id}?`);
			if (!confirmed) {
				console.log(chalk.dim("aborted"));
				return;
			}
		}

		const spinner = make_spinner(`Removing ${id}...`).start();
		const result = await client.pipelines.oidc_trust.delete(id, { owner_id });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`removed ${id}`);
	};

// ─── analysis-templates subcommand actions ─────────────────────────
//
// `analysis-templates list / get / create / update / delete` wrap the
// API client methods added in Phase 2.A. `--threshold-file` reads UTF-8
// from disk and sends the contents as the `threshold_dsl` body field —
// the orchestrator validates server-side and surfaces parse failure as
// `validation_error`.

const read_threshold_file = (path_: string): { ok: true; value: string } | { ok: false; error: string } => {
	try {
		const text = readFileSync(path_, "utf8");
		if (text.trim().length === 0) return { ok: false, error: `threshold file is empty: ${path_}` };
		return { ok: true, value: text };
	} catch (e) {
		return { ok: false, error: `failed to read threshold file ${path_}: ${String(e)}` };
	}
};

export interface AnalysisTemplatesListOptions {
	ownerId?: string;
}

export const action_analysis_templates_list =
	(client_factory: ClientFactory) =>
	async (options: AnalysisTemplatesListOptions): Promise<void> => {
		const spinner = make_spinner("Listing analysis templates...").start();
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const result = await client.pipelines.analysis_templates.list({ owner_id });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`${result.value.length} template(s)`);
		if (result.value.length === 0) {
			console.log(chalk.dim("  no templates — run `pipelines analysis-templates create` to add one"));
			return;
		}
		for (const t of result.value) {
			const dsl_text = typeof t.threshold_dsl === "string" ? t.threshold_dsl : String(t.threshold_dsl ?? "");
			const dsl_lines = dsl_text.split("\n").filter((l: string) => l.trim().length > 0).length;
			console.log(`  ${chalk.bold(t.id)}  ${chalk.cyan(t.name)}  ${dsl_lines} threshold(s)  ${t.window_ms}ms`);
		}
	};

export interface AnalysisTemplatesGetOptions {
	ownerId?: string;
}

export const action_analysis_templates_get =
	(client_factory: ClientFactory) =>
	async (id: string, options: AnalysisTemplatesGetOptions): Promise<void> => {
		const spinner = make_spinner(`Fetching ${id}...`).start();
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const result = await client.pipelines.analysis_templates.get(id, { owner_id });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(result.value.id);
		console.log(JSON.stringify(result.value, null, 2));
	};

export interface AnalysisTemplatesCreateOptions {
	name?: string;
	ownerId?: string;
	thresholdFile?: string;
	windowMs?: string;
}

export const action_analysis_templates_create =
	(client_factory: ClientFactory) =>
	async (options: AnalysisTemplatesCreateOptions): Promise<void> => {
		const spinner = make_spinner("Creating analysis template...").start();
		const client = client_factory();

		const name = options.name;
		if (name === undefined || name === "") return fail_with(spinner, "--name <name> is required");

		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const threshold_file = options.thresholdFile;
		if (threshold_file === undefined || threshold_file === "") return fail_with(spinner, "--threshold-file <path> is required");
		const threshold = read_threshold_file(threshold_file);
		if (!threshold.ok) return fail_with(spinner, threshold.error);

		const window_ms = options.windowMs !== undefined ? Number.parseInt(options.windowMs, 10) : undefined;
		if (options.windowMs !== undefined && (!Number.isInteger(window_ms) || (window_ms ?? -1) <= 0)) {
			return fail_with(spinner, `--window-ms must be a positive integer, got "${options.windowMs}"`);
		}

		const result = await client.pipelines.analysis_templates.create({ owner_id, name, threshold_dsl: threshold.value, window_ms });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`created ${result.value.id}`);
		console.log(chalk.green(`  id:         ${result.value.id}`));
		console.log(`  name:       ${result.value.name}`);
		console.log(`  window_ms:  ${result.value.window_ms}`);
	};

export interface AnalysisTemplatesUpdateOptions {
	ownerId?: string;
	name?: string;
	thresholdFile?: string;
	windowMs?: string;
}

export const action_analysis_templates_update =
	(client_factory: ClientFactory) =>
	async (id: string, options: AnalysisTemplatesUpdateOptions): Promise<void> => {
		const spinner = make_spinner(`Updating ${id}...`).start();
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const patch: { owner_id: string; name?: string; threshold_dsl?: string; window_ms?: number } = { owner_id };
		if (options.name !== undefined) patch.name = options.name;
		if (options.thresholdFile !== undefined) {
			const threshold = read_threshold_file(options.thresholdFile);
			if (!threshold.ok) return fail_with(spinner, threshold.error);
			patch.threshold_dsl = threshold.value;
		}
		if (options.windowMs !== undefined) {
			const window_ms = Number.parseInt(options.windowMs, 10);
			if (!Number.isInteger(window_ms) || window_ms <= 0) return fail_with(spinner, `--window-ms must be a positive integer, got "${options.windowMs}"`);
			patch.window_ms = window_ms;
		}
		if (patch.name === undefined && patch.threshold_dsl === undefined && patch.window_ms === undefined) {
			return fail_with(spinner, "no updates supplied (pass --name, --threshold-file, or --window-ms)");
		}

		const result = await client.pipelines.analysis_templates.update(id, patch);
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`updated ${result.value.id}`);
	};

export interface AnalysisTemplatesDeleteOptions {
	ownerId?: string;
}

export const action_analysis_templates_delete =
	(client_factory: ClientFactory) =>
	async (id: string, options: AnalysisTemplatesDeleteOptions): Promise<void> => {
		const spinner = make_spinner(`Deleting ${id}...`).start();
		const client = client_factory();
		const owner_id = options.ownerId ?? (await resolve_owner_id(client));
		if (owner_id === null) return fail_with(spinner, "--owner-id required (could not resolve from session)");

		const result = await client.pipelines.analysis_templates.delete(id, { owner_id });
		if (!result.ok) return fail_with(spinner, result.error.message);
		spinner.succeed(`deleted ${id}`);
	};

// ─── workflow migrate subcommand action ────────────────────────────
//
// `pipelines workflow migrate <package>` re-renders `.github/workflows/
// deploy.yml` from the current scaffolder template. Convenience for
// Phase 15 soft-cutover — owners of pre-Phase-15 repos can run this
// once to drop their `DEVPAD_PIPELINES_TOKEN` reliance.
//
// Path discovery:
//   1. `--cwd <path>` overrides everything.
//   2. Otherwise, current working directory is assumed to be the repo
//      root (no orchestrator round-trip — we don't need the repo_url to
//      render a workflow file, only to identify what the user named the
//      package, which they pass explicitly).

export interface WorkflowMigrateOptions {
	cwd?: string;
	rollout?: string;
	defaultGate?: string;
	buildShape?: string;
	dryRun?: boolean;
}

export const action_workflow_migrate =
	(_client_factory: ClientFactory) =>
	async (package_name: string, options: WorkflowMigrateOptions): Promise<void> => {
		const spinner = make_spinner(`Migrating workflow for ${package_name}...`).start();

		const cwd = options.cwd ?? process.cwd();
		const workflow_path = path.join(cwd, ".github", "workflows", "deploy.yml");

		const rollout = options.rollout ?? "gradual";
		const default_gate = options.defaultGate ?? "auto";
		const build_shape = options.buildShape ?? "single-file";

		if (!is_rollout_mode(rollout)) return fail_with(spinner, `--rollout must be one of ${ROLLOUT_MODES.join(", ")}; got "${rollout}"`);
		if (!is_gate_kind(default_gate)) return fail_with(spinner, `--default-gate must be one of ${GATE_KINDS.join(", ")}; got "${default_gate}"`);
		if (!is_build_shape(build_shape)) return fail_with(spinner, `--build-shape must be one of ${BUILD_SHAPES.join(", ")}; got "${build_shape}"`);

		const entry = SCAFFOLDER_TEMPLATES.find(e => e.relative_path === ".github/workflows/deploy.yml");
		if (entry === undefined) return fail_with(spinner, "scaffolder template manifest missing .github/workflows/deploy.yml — check @devpad/pipeline-templates");

		// Locate the templates root the same way scaffold_package does — by
		// resolving against the pipeline-templates package's source tree.
		// `import.meta.dir` here is `packages/cli/src/commands/`; same depth
		// as `packages/cli/src/scaffolder/` so 3x `..` lands on `packages/`.
		const templates_root = path.resolve(import.meta.dir, "..", "..", "..", "pipeline-templates", "src", "scaffolder", "templates");
		const source_path = path.join(templates_root, entry.template_path);
		if (!existsSync(source_path)) return fail_with(spinner, `scaffolder template not found on disk: ${source_path}`);

		const source = readFileSync(source_path, "utf8");
		const vars = derive_template_vars({ package_name, rollout, default_gate, build_shape, now: new Date() });
		const rendered = render_pkg_template(source, vars as unknown as Record<string, string>);
		if (!rendered.ok) return fail_with(spinner, `failed to render workflow template: ${rendered.error.message}`);

		const existed_before = existsSync(workflow_path);
		const previous = existed_before ? readFileSync(workflow_path, "utf8") : "";
		const changed = previous !== rendered.value;

		if (options.dryRun === true) {
			const summary = changed ? `would update ${workflow_path}` : `${workflow_path} already up-to-date`;
			spinner.succeed(summary);
			// `spinner.succeed` no-ops in non-TTY; emit a parallel log so CI
			// (and the integration tests that stub console.log) see the result.
			console.log(summary);
			if (changed) {
				const old_lines = previous.split("\n").length;
				const new_lines = rendered.value.split("\n").length;
				console.log(`  before: ${old_lines} lines`);
				console.log(`  after:  ${new_lines} lines`);
				console.log(chalk.dim(`  omit --dry-run to write`));
			}
			return;
		}

		mkdirSync(path.dirname(workflow_path), { recursive: true });
		writeFileSync(workflow_path, rendered.value, "utf8");
		const write_summary = changed ? `wrote ${workflow_path}` : `${workflow_path} unchanged`;
		spinner.succeed(write_summary);
		console.log(write_summary);
		if (changed) {
			const old_lines = previous.split("\n").length;
			const new_lines = rendered.value.split("\n").length;
			console.log(`  before: ${old_lines} lines${existed_before ? "" : " (new file)"}`);
			console.log(`  after:  ${new_lines} lines`);
		}
	};

const resolve_owner_id = async (client: ApiClient): Promise<string | null> => {
	if (process.env.DEVPAD_USER_ID !== undefined && process.env.DEVPAD_USER_ID !== "") return process.env.DEVPAD_USER_ID;
	const session = await client.auth.session();
	if (!session.ok) return null;
	const user = session.value.user as { id?: string } | null;
	return user?.id ?? null;
};

/**
 * Resolve a project slug (`--project <slug>`) to its internal id. We list
 * the caller's projects and match on either `project_id` (the slug) or
 * `id` (the internal id) — accepting both keeps the CLI usable from
 * scripts that already have the internal id handy.
 */
const resolve_project_id = async (client: ApiClient, slug_or_id: string): Promise<string | null> => {
	const list = await client.projects.list();
	if (!list.ok) return null;
	const match = list.value.find(p => p.project_id === slug_or_id || p.id === slug_or_id);
	return match?.id ?? null;
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
		.option("--build-shape <shape>", "Build output shape: single-file | directory-bundle", "single-file")
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

	pipelines.command("cancel <run-id>").description("Cancel an in-flight pipeline run").action(action_cancel(client_factory));

	pipelines.command("rollback <run-id>").description("Roll a run back to its previous production version").action(action_rollback(client_factory));

	const artifacts = pipelines.command("artifacts").description("Manage pipeline artifacts");

	artifacts
		.command("upload")
		.description("Upload artifacts to corpus")
		.requiredOption("--package <name>", "Package name")
		.option("--bundle <path>", "Path to single-file worker bundle (dist/_worker.js). Mutually exclusive with --bundle-dir")
		.option("--bundle-dir <path>", "Path to directory-bundle worker (e.g. dist/_worker.js/). Mutually exclusive with --bundle")
		.option("--main-module <name>", "Entrypoint module name inside --bundle-dir (e.g. index.js). Required with --bundle-dir")
		.option("--assets-dir <path>", "Path to static-assets directory (e.g. dist/). Files uploaded as CF assets")
		.option("--asset-config <path-or-json>", "JSON file path OR inline JSON for asset config")
		.option("--manifest <path>", "Optional path to env manifest (dist/manifest.json). Defaults to empty object")
		.requiredOption("--infra-plan <path>", "Path to infra plan (infra.ts)")
		.requiredOption("--pipeline <path>", "Path to pipeline definition (pipeline.ts)")
		.requiredOption("--grants <path>", "Path to grants definition (grants.ts)")
		.requiredOption("--output <path>", "Output path for version set JSON")
		.option("--git-sha <sha>", "Git SHA (default: from environment or zeroed)")
		.option("--compatibility-date <date>", "Compatibility date (default: 2025-05-01)")
		.option("--compatibility-flag <flag>", "Compatibility flag (repeatable)", (value: string, prev: string[] | undefined): string[] => [...(prev ?? []), value])
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

	const events = runs
		.command("events")
		.description(
			"Manage stage events on a pipeline run (Phase 2.C webhook ingestion).\n" +
				"CLI uses the admin bearer (PIPELINES_TOKEN via DEVPAD_API_KEY).\n" +
				"External CI should call POST /runs/:id/events directly with an OIDC session JWT, not via this CLI."
		);

	events
		.command("ingest <run-id>")
		.description("Ingest an external webhook event against a run. Server-side stamps payload.source = \"external\".")
		.requiredOption("--stage <name>", "Stage the event is associated with")
		.requiredOption(`--kind <kind>`, `Event kind — one of ${STAGE_EVENT_KINDS.join(", ")}`)
		.option("--payload-file <path>", "Path to a JSON file used as the event payload")
		.option("--idempotency-key <uuid>", "UUID idempotency key (defaults to a fresh randomUUID — non-replayable)")
		.action(action_runs_events_ingest(client_factory));

	events.command("list <run-id>").description("List stored events for a run (newest-first)").action(action_runs_events_list(client_factory));

	const grants = pipelines.command("grants").description("Manage vault grants");

	grants.command("list").description("List vault grants for a package").requiredOption("--package <id>", "Package ID to list grants for").action(action_grants_list(client_factory));

	grants.command("approve <grant-id>").description("Approve a pending vault grant").option("--user <user-id>", "User ID granting approval (defaults to $DEVPAD_USER_ID)").action(action_grants_approve(client_factory));

	grants
		.command("deny <grant-id>")
		.description("Deny a pending vault grant")
		.option("--user <user-id>", "User ID denying the grant (defaults to $DEVPAD_USER_ID)")
		.option("--reason <text>", "Optional denial reason")
		.action(action_grants_deny(client_factory));

	const packages = pipelines
		.command("packages")
		.description(
			"Manage pipeline packages.\n" + "Typical flow: `packages create` to register a pipeline-managed package, then in your repo add\n" + "infra.ts, pipeline.ts, grants.ts, and a CI workflow that calls `pipelines artifacts upload`."
		);

	packages.command("list").description("List pipeline packages").option("--project <id-or-slug>", "Filter by linked devpad project (accepts project_id or internal id)").action(action_packages_list(client_factory));

	packages.command("get <id>").description("Get a pipeline package by id").action(action_packages_get(client_factory));

	packages
		.command("create [name]")
		.description("Register a new pipeline package. By convention `id` equals `name`.")
		.option("--name <name>", "Package name (alternative to positional)")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.option("--project <id-or-slug>", "Link to devpad project (accepts project_id or internal id)")
		.option("--repo-url <url>", "Optional git repo URL")
		.action(action_packages_create(client_factory));

	packages
		.command("update <id>")
		.description("Partially update a pipeline package")
		.option("--project <id-or-slug>", "Link to devpad project (accepts project_id or internal id)")
		.option("--repo-url <url>", "New git repo URL")
		.option("--script-name-overrides <json>", "JSON object of stage→script-name overrides")
		.action(action_packages_update(client_factory));

	packages
		.command("delete <id>")
		.description("Delete a pipeline package. Refuses if active pipeline_run rows reference it.")
		.option("--force", "Confirmation flag (orchestrator still 409s on active runs; you must clean those up first)")
		.action(action_packages_delete(client_factory));

	const oidc_trust = pipelines.command("oidc-trust").description("Manage GitHub Actions OIDC trust policies (Phase 15)");

	oidc_trust.command("list").description("List trust policies for the current owner").option("--owner-id <id>", "Owner user id (defaults to current session)").action(action_oidc_trust_list(client_factory));

	oidc_trust
		.command("show <id>")
		.description("Show a single trust policy")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.action(action_oidc_trust_show(client_factory));

	oidc_trust
		.command("add")
		.description("Create a new trust policy. Prompts interactively in a TTY; flags-only when scripted.")
		.option("--owner <gh-owner>", "GitHub repository_owner to trust (e.g. f0rbit)")
		.option("--owner-id <id>", "Devpad owner user id (defaults to current session)")
		.option("--repo-pattern <glob>", "Glob matched against the repo name (default: *)")
		.option("--aud <url>", "Expected OIDC `aud` claim (default: orchestrator URL)")
		.option("--actions <list>", "Comma-separated allowed actions (default: artifacts:upload,runs:start)")
		.option("--refs <list>", "Comma-separated allowed refs (default: any)")
		.option("--environments <list>", "Comma-separated allowed environments (default: any)")
		.option("--ttl <seconds>", "Session token TTL in seconds (default: 900)")
		.action(action_oidc_trust_add(client_factory));

	oidc_trust
		.command("remove <id>")
		.description("Soft-delete a trust policy (row preserved for audit)")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.option("--yes", "Skip confirmation prompt")
		.action(action_oidc_trust_remove(client_factory));

	const analysis_templates = pipelines.command("analysis-templates").description("Manage pipeline_analysis_template rows (threshold DSL + window for analysis gates)");

	analysis_templates
		.command("list")
		.description("List analysis templates for the current owner")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.action(action_analysis_templates_list(client_factory));

	analysis_templates
		.command("get <id>")
		.description("Get a single analysis template")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.action(action_analysis_templates_get(client_factory));

	analysis_templates
		.command("create")
		.description("Create a new analysis template. `--threshold-file` is a UTF-8 file whose contents are the threshold DSL.")
		.requiredOption("--name <name>", "Template name (e.g. default-analysis)")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.requiredOption("--threshold-file <path>", "Path to a UTF-8 file containing the threshold DSL")
		.option("--window-ms <ms>", "Analysis window in milliseconds (default: 600000)")
		.action(action_analysis_templates_create(client_factory));

	analysis_templates
		.command("update <id>")
		.description("Partially update an analysis template")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.option("--name <name>", "New template name")
		.option("--threshold-file <path>", "Path to a UTF-8 file containing the new threshold DSL")
		.option("--window-ms <ms>", "New analysis window in milliseconds")
		.action(action_analysis_templates_update(client_factory));

	analysis_templates
		.command("delete <id>")
		.description("Delete an analysis template. Does not consult pipeline_run.resolved_gates — runs snapshot the template at resolve-time.")
		.option("--owner-id <id>", "Owner user id (defaults to current session)")
		.action(action_analysis_templates_delete(client_factory));

	const workflow = pipelines.command("workflow").description("Workflow-file maintenance for pipeline-managed repos");

	workflow
		.command("migrate <package>")
		.description("Re-render .github/workflows/deploy.yml from the current scaffolder template (Phase 15 OIDC migration aid)")
		.option("--cwd <path>", "Repository root (default: current working directory)")
		.option("--rollout <mode>", "Rollout mode used in the template: gradual | atomic", "gradual")
		.option("--default-gate <kind>", "Default gate kind: manual | auto | analysis", "auto")
		.option("--build-shape <shape>", "Build shape: single-file | directory-bundle", "single-file")
		.option("--dry-run", "Print the diff summary instead of writing")
		.action(action_workflow_migrate(client_factory));

	return pipelines;
};
