/**
 * @module core/services/pipelines/deploy
 *
 * Deploy a single stage to Cloudflare. The pure helper
 * {@link build_deployment_request} maps domain inputs (stage, version
 * set, optional previous version id) to the Cloudflare provider's
 * `CreateDeploymentInput` — testable in isolation against
 * {@link CloudflareProvider}'s schema.
 *
 * The side-effect wrapper {@link deploy_stage} takes a
 * {@link CloudflareProvider} (an instance of the in-memory fake in tests,
 * the REST-backed implementation in prod) and runs the upload +
 * deployment sequence. Idempotent upload is keyed by `(script_name,
 * version_set_id)` — we re-use an existing version annotated with the
 * same `version_set_id` instead of uploading twice.
 */

import type {
	AssetConfig,
	AssetUpload,
	CloudflareError,
	CloudflareProvider,
	CreateDeploymentInput,
	ModuleUpload,
	VersionBinding,
	WorkerDeployment,
	WorkerVar,
	WorkerVersion,
} from "@devpad/pipeline-fakes";
import type { Stage } from "@devpad/pipeline-templates";
import { err, ok, type Result } from "@f0rbit/corpus";
import { merge_bindings } from "./bindings.js";
import { compute_caller_identity_vars } from "./caller-identity.js";

export type BundleFetchError = { code: "bundle_unavailable"; message: string };

export type DeployError =
	| CloudflareError
	| BundleFetchError
	| { code: "no_version_uploaded"; message: string }
	/**
	 * #160: the target script does not exist on Cloudflare (or its live
	 * state is unreadable), so the orchestrator cannot determine the
	 * bindings currently active on it. The orchestrator refuses to
	 * bootstrap scripts — packages are created by their own infra
	 * (alchemy / wrangler versions upload) first; uploading a
	 * binding-less version here is exactly the failure mode #160
	 * documents.
	 */
	| { code: "script_not_found"; message: string };

/**
 * Read-side shape the orchestrator uses to fetch a compiled worker
 * bundle for a given version-set. Production wiring resolves
 * `version_set_id` to the manifest's `builds.worker.artifact_ref`
 * (single-file) or `builds.worker.bundle_manifest_ref` (directory) and
 * pulls the bytes from R2 via the corpus `Backend.data` client. Tests
 * inject a stub that returns either a single-file `Uint8Array` or a
 * directory bundle of modules + optional assets.
 *
 * The discriminator mirrors {@link import("@devpad/pipeline-fakes").UploadVersionInput}'s
 * `kind` so the orchestrator can forward straight to
 * `cf.versions.upload(...)` without re-shaping.
 *
 * `bindings` carries the orchestrator's defaults (vault + pulse) so the
 * provider stays the single source for everything except caller identity
 * (which `deploy_stage` stamps on each call).
 */
export type BundlePayload =
	| {
			kind: "single_file";
			bytes: Uint8Array;
			main_module?: string;
			compatibility_date?: string;
			compatibility_flags?: string[];
			bindings?: VersionBinding[];
	  }
	| {
			kind: "directory_bundle";
			modules: ModuleUpload[];
			main_module: string;
			compatibility_date: string;
			compatibility_flags?: string[];
			bindings?: VersionBinding[];
			assets?: { assets: AssetUpload[]; config?: AssetConfig };
	  };

export type BundleProvider = {
	get(input: {
		version_set_id: string;
		package_name: string;
		environment: "staging" | "production";
	}): Promise<Result<BundlePayload, BundleFetchError>>;
};

export type DeploymentResult = {
	version: WorkerVersion;
	deployment_id: string;
};

/**
 * Single-stage deploy request shape. `script_name` corresponds to the
 * Cloudflare Worker script; `traffic` is the percentage to land at this
 * stage. The pure helper {@link build_deployment_request} packs this
 * (plus an optional previous active version) into a percentage strategy
 * that sums to 100 — the only shape the {@link CloudflareProvider}
 * accepts.
 */
export type DeployRequest = {
	script_name: string;
	stage: Stage;
	version_set_id: string;
	current_version_id: string;
	previous_active_version_id: string | null;
};

/**
 * CF accepts only `workers/message`, `workers/tag`, `workers/alias` as
 * annotation keys (validation error 10021 on anything else). We use
 * `workers/tag` to carry our `version_set_id` so the orchestrator's
 * idempotent dedup keeps working — both reads (`versions.list`) and
 * writes (`versions.upload`) go through this single key.
 */
const VERSION_KEY = "workers/tag";

/**
 * Build the Cloudflare `deployments.create` payload for a stage deploy.
 *
 * - Stage at 100% traffic → single-version strategy at 100%.
 * - Stage at <100% (gradual wave) → two-version strategy: new at
 *   `stage.traffic`, previous at `100 - stage.traffic`. Requires
 *   `previous_active_version_id` (the version currently serving prod
 *   traffic) — without it we cannot legally form a partial deploy.
 * - Stage at 0% (staging) → single-version strategy at 100% routed
 *   *only* to the staging environment; the orchestrator handles the
 *   env routing elsewhere, so the percentage stays 100 to satisfy the
 *   invariant.
 *
 * Returns a typed error if the inputs are inconsistent (e.g. a partial
 * rollout without a previous version to ramp down).
 */
export const build_deployment_request = (req: DeployRequest): Result<CreateDeploymentInput, DeployError> => {
	const { script_name, stage, current_version_id, previous_active_version_id } = req;

	if (stage.traffic === 100 || stage.traffic === 0) {
		return ok({
			script_name,
			strategy: {
				strategy: "percentage",
				versions: [{ version_id: current_version_id, percentage: 100 }],
			},
		});
	}

	if (previous_active_version_id === null) {
		return err({
			code: "validation",
			message: `partial-traffic stage ${stage.name} at ${String(stage.traffic)}% requires a previous active version`,
		});
	}

	return ok({
		script_name,
		strategy: {
			strategy: "percentage",
			versions: [
				{ version_id: current_version_id, percentage: stage.traffic },
				{ version_id: previous_active_version_id, percentage: 100 - stage.traffic },
			],
		},
	});
};

/**
 * Find an already-uploaded version matching this `version_set_id` so we
 * don't upload twice. The fake (and the real CF API) tags versions with
 * an annotation; we treat that annotation as the dedup key.
 */
const find_existing_version = async (
	cf: CloudflareProvider,
	script_name: string,
	version_set_id: string,
): Promise<Result<WorkerVersion | null, CloudflareError>> => {
	const list_result = await cf.versions.list(script_name);
	if (!list_result.ok) {
		if (list_result.error.code === "not_found") return ok(null);
		return list_result;
	}
	const match = list_result.value.find((v) => v.annotations?.[VERSION_KEY] === version_set_id);
	return ok(match ?? null);
};

const upload_version = async (
	cf: CloudflareProvider,
	script_name: string,
	version_set_id: string,
	vars: WorkerVar[],
	bundle: BundlePayload,
	merged: { bindings: VersionBinding[]; keep_bindings: string[] },
): Promise<Result<WorkerVersion, CloudflareError>> => {
	const annotations = { [VERSION_KEY]: version_set_id };
	if (bundle.kind === "directory_bundle") {
		return cf.versions.upload({
			kind: "directory_bundle",
			script_name,
			annotations,
			vars,
			modules: bundle.modules,
			main_module: bundle.main_module,
			compatibility_date: bundle.compatibility_date,
			compatibility_flags: bundle.compatibility_flags,
			bindings: merged.bindings,
			keepBindings: merged.keep_bindings.length > 0 ? merged.keep_bindings : undefined,
			assets: bundle.assets,
		});
	}
	return cf.versions.upload({
		kind: "single_file",
		script_name,
		annotations,
		vars,
		bundle: bundle.bytes,
		main_module: bundle.main_module,
		compatibility_date: bundle.compatibility_date,
		compatibility_flags: bundle.compatibility_flags,
		bindings: merged.bindings,
		keepBindings: merged.keep_bindings.length > 0 ? merged.keep_bindings : undefined,
	});
};

/**
 * Discover the worker version currently serving partial-traffic so a
 * gradual deploy can ramp it down. Picks the largest-percentage version
 * in the most recently created deployment that is not the candidate
 * we're about to deploy. Returns `null` when the script has no prior
 * deployments (first deploy of a brand-new package).
 */
const lookup_previous_active_version = async (
	cf: CloudflareProvider,
	script_name: string,
	exclude_version_id: string | null,
): Promise<Result<string | null, CloudflareError>> => {
	const list = await cf.deployments.list(script_name);
	if (!list.ok) {
		if (list.error.code === "not_found") return ok(null);
		return list;
	}
	const sorted = list.value
		.slice()
		.toSorted((a, b) => (a.created_on < b.created_on ? 1 : a.created_on > b.created_on ? -1 : 0));
	for (const deployment of sorted) {
		const candidates = deployment.strategy.versions.filter((v) => v.version_id !== exclude_version_id);
		if (candidates.length === 0) continue;
		const best = candidates.slice().toSorted((a, b) => b.percentage - a.percentage)[0];
		return ok(best.version_id);
	}
	return ok(null);
};

/**
 * Read the bindings of the versions currently ACTIVE on `script_name`
 * (#160). The active deployment is the most recently created one; each
 * version entry in its percentage strategy is read via
 * `cf.versions.get` — never the script settings endpoint, which shows
 * the latest upload rather than what's live.
 *
 * Fallbacks:
 * - No deployments but the script has versions (uploaded, never
 *   deployed — e.g. `wrangler versions upload` from CI): read the
 *   LATEST version's bindings, mirroring Cloudflare's own
 *   `keep_bindings` inheritance semantics. Never-deployed scripts are
 *   rare — when this fires, the inheritance source equals what the
 *   next deployment would act on anyway.
 * - Script entirely missing (no deployments AND no versions) → typed
 *   `script_not_found`: the orchestrator refuses to bootstrap a Worker
 *   it knows nothing about (and would otherwise upload a version with
 *   only the platform bindings — the #160 incident).
 *
 * Per-stage correctness is free: each stage's script was created by the
 * package's own infra with its own resource ids, so read-then-merge
 * keeps those ids alive without the orchestrator ever learning them.
 */
const newest_version = (versions: WorkerVersion[]): WorkerVersion | undefined =>
	versions.reduce<WorkerVersion | undefined>(
		(best, v) => (best === undefined || v.number > best.number ? v : best),
		undefined,
	);

const read_live_bindings = async (
	cf: CloudflareProvider,
	script_name: string,
): Promise<Result<{ bindings: VersionBinding[]; source: string }, DeployError>> => {
	const deployments = await cf.deployments.list(script_name);
	if (!deployments.ok) {
		if (deployments.error.code !== "not_found") return deployments;
		const versions = await cf.versions.list(script_name);
		if (!versions.ok) {
			return err({
				code: "script_not_found",
				message: `script ${script_name} does not exist on Cloudflare — create it via the package's own infra (alchemy/wrangler versions upload) before starting orchestrated runs`,
			});
		}
		const latest = newest_version(versions.value);
		if (!latest) {
			return err({ code: "script_not_found", message: `script ${script_name} has no versions and no deployments` });
		}
		return ok({
			bindings: latest.bindings ?? [],
			source: `latest version ${latest.id} (no active deployment)`,
		});
	}

	const active = deployments.value.reduce<WorkerDeployment | undefined>(
		(best, d) => (best === undefined || d.created_on > best.created_on ? d : best),
		undefined,
	);
	if (!active) {
		// Script exists (deployments list ok) but zero deployments: fall
		// back to the latest uploaded version's bindings.
		const versions = await cf.versions.list(script_name);
		if (!versions.ok) {
			return err({
				code: "script_not_found",
				message: `script ${script_name} is unreadable: ${versions.error.message}`,
			});
		}
		const latest = newest_version(versions.value);
		if (!latest) {
			return err({ code: "script_not_found", message: `script ${script_name} has no versions and no deployments` });
		}
		return ok({
			bindings: latest.bindings ?? [],
			source: `latest version ${latest.id} (no active deployment)`,
		});
	}

	// Gather bindings from every version in the active strategy (a
	// partial rollout has two live versions). Entries collect in strategy
	// order; `merge_bindings` resolves same-name ties by last-read-wins.
	const gathered: VersionBinding[] = [];
	const sources: string[] = [];
	for (const version of active.strategy.versions) {
		const read = await cf.versions.get(script_name, version.version_id);
		if (!read.ok) {
			return err({
				code: "script_not_found",
				message: `active version ${version.version_id} of script ${script_name} is unreadable: ${read.error.message}`,
			});
		}
		gathered.push(...(read.value.bindings ?? []));
		sources.push(version.version_id);
	}
	return ok({ bindings: gathered, source: `active deployment ${active.id} (versions: ${sources.join(", ")})` });
};

/**
 * Deploy a stage. Sequence:
 *
 * 1. Look up or upload the worker version for this `version_set_id`
 *    (idempotent).
 * 2. For uploads: read the bindings live on the target script
 *    (`read_live_bindings`) and merge them with the orchestrator's
 *    platform set so package-owned bindings survive promotion (#160).
 * 3. For partial-traffic stages, look up the currently-active
 *    predecessor version so the percentage strategy can ramp it down.
 * 4. Build the Cloudflare deployment payload via the pure helper.
 * 5. Create the deployment.
 *
 * Each step short-circuits on a typed error and bubbles up the same
 * {@link DeployError} union the helpers return. No throws — every
 * outcome is a {@link Result}.
 */
export const deploy_stage = async (
	cf: CloudflareProvider,
	bundles: BundleProvider,
	input: {
		script_name: string;
		stage: Stage;
		version_set_id: string;
		package_name: string;
		environment: "staging" | "production";
	},
): Promise<Result<DeploymentResult, DeployError>> => {
	const { script_name, stage, version_set_id, package_name, environment } = input;

	const existing = await find_existing_version(cf, script_name, version_set_id);
	if (!existing.ok) return existing;

	const identity_vars = compute_caller_identity_vars({ package_name, environment, version_set_id });
	let version_result: Result<WorkerVersion, CloudflareError | BundleFetchError>;
	if (existing.value !== null) {
		version_result = ok(existing.value);
	} else {
		const bundle = await bundles.get({ version_set_id, package_name, environment });
		if (!bundle.ok) return bundle;
		// #160: preserve what's live. The platform set (bundle bindings +
		// identity vars) wins name collisions; secrets ride keep_bindings.
		const live = await read_live_bindings(cf, script_name);
		if (!live.ok) return live;
		const merged = merge_bindings({
			live: live.value.bindings,
			platform: [...(bundle.value.bindings ?? []), ...identity_vars],
		});
		// The identity vars ride the upload's `vars` (appended to the wire
		// bindings by the provider); they took part in the merge only to
		// evict stale same-named live entries, so drop them here or they'd
		// be sent twice.
		const identity_names = new Set(identity_vars.map((v) => v.name));
		const upload_bindings = { ...merged, bindings: merged.bindings.filter((b) => !identity_names.has(b.name)) };
		version_result = await upload_version(
			cf,
			script_name,
			version_set_id,
			identity_vars,
			bundle.value,
			upload_bindings,
		);
	}
	if (!version_result.ok) return version_result;
	const version = version_result.value;

	const needs_previous = stage.traffic !== 100 && stage.traffic !== 0;
	const previous_result = needs_previous ? await lookup_previous_active_version(cf, script_name, version.id) : ok(null);
	if (!previous_result.ok) return previous_result;

	// Bootstrap: no prior deployment exists, so a partial-traffic stage
	// has no predecessor to ramp down. Treat as a single-version 100%
	// deploy — the orchestrator never gets here for a brand-new
	// package (the first stage is always staging at 0%), but the
	// invariant matters for tests that skip the staging path.
	const effective_stage: Stage = needs_previous && previous_result.value === null ? { ...stage, traffic: 100 } : stage;

	const payload = build_deployment_request({
		script_name,
		stage: effective_stage,
		version_set_id,
		current_version_id: version.id,
		previous_active_version_id: previous_result.value,
	});
	if (!payload.ok) return payload;

	const deployment = await cf.deployments.create(payload.value);
	if (!deployment.ok) return deployment;

	return ok({ version, deployment_id: deployment.value.id });
};
