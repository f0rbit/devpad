/**
 * @module @devpad/cli/commands/pipelines
 *
 * `devpad pipelines …` subcommand group: `init`, `runs start`, `approve`,
 * `cancel`, `rollback`, `artifacts upload`. `init` shells out to the scaffolder;
 * the others wrap `client.pipelines.*` so we never re-implement HTTP plumbing.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type ApiClient, ApiClient as ApiClientCtor } from "@devpad/api";
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
const is_build_shape = (s: string): s is typeof BUILD_SHAPES[number] => (BUILD_SHAPES as readonly string[]).includes(s);

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
		build_shape: options.buildShape as typeof BUILD_SHAPES[number],
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

	const grants = pipelines.command("grants").description("Manage vault grants");

	grants.command("list").description("List vault grants for a package").requiredOption("--package <id>", "Package ID to list grants for").action(action_grants_list(client_factory));

	grants.command("approve <grant-id>").description("Approve a pending vault grant").option("--user <user-id>", "User ID granting approval (defaults to $DEVPAD_USER_ID)").action(action_grants_approve(client_factory));

	grants
		.command("deny <grant-id>")
		.description("Deny a pending vault grant")
		.option("--user <user-id>", "User ID denying the grant (defaults to $DEVPAD_USER_ID)")
		.option("--reason <text>", "Optional denial reason")
		.action(action_grants_deny(client_factory));

	return pipelines;
};
