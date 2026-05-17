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

import type { CloudflareError, CloudflareProvider, CreateDeploymentInput, VersionBinding, WorkerVar, WorkerVersion } from "@devpad/pipeline-fakes";
import type { Stage } from "@devpad/pipeline-templates";
import { err, ok, type Result } from "@f0rbit/corpus";
import { compute_caller_identity_vars } from "./caller-identity.js";

export type BundleFetchError = { code: "bundle_unavailable"; message: string };

export type DeployError = CloudflareError | BundleFetchError | { code: "no_version_uploaded"; message: string };

/**
 * Read-side shape the orchestrator uses to fetch a compiled worker
 * bundle for a given version-set. Production wiring resolves
 * `version_set_id` to the manifest's `builds.worker.artifact_ref` and
 * pulls the bytes from R2 via the corpus `Backend.data` client. Tests
 * inject a stub that returns a fixed `Uint8Array`.
 */
export type BundlePayload = {
	bytes: Uint8Array;
	main_module?: string;
	compatibility_date?: string;
	compatibility_flags?: string[];
	bindings?: VersionBinding[];
};

export interface BundleProvider {
	get(input: { version_set_id: string; package_name: string; environment: "staging" | "production" }): Promise<Result<BundlePayload, BundleFetchError>>;
}

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

const VERSION_KEY = "version_set_id";

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
			message: `partial-traffic stage ${stage.name} at ${stage.traffic}% requires a previous active version`,
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
const find_existing_version = async (cf: CloudflareProvider, script_name: string, version_set_id: string): Promise<Result<WorkerVersion | null, CloudflareError>> => {
	const list_result = await cf.versions.list(script_name);
	if (!list_result.ok) {
		if (list_result.error.code === "not_found") return ok(null);
		return list_result;
	}
	const match = list_result.value.find(v => v.annotations?.[VERSION_KEY] === version_set_id);
	return ok(match ?? null);
};

const upload_version = async (
	cf: CloudflareProvider,
	script_name: string,
	version_set_id: string,
	vars: WorkerVar[],
	bundle: BundlePayload,
): Promise<Result<WorkerVersion, CloudflareError>> => {
	return cf.versions.upload({
		script_name,
		annotations: { [VERSION_KEY]: version_set_id },
		vars,
		bundle: bundle.bytes,
		main_module: bundle.main_module,
		compatibility_date: bundle.compatibility_date,
		compatibility_flags: bundle.compatibility_flags,
		bindings: bundle.bindings,
	});
};

/**
 * Discover the worker version currently serving partial-traffic so a
 * gradual deploy can ramp it down. Picks the largest-percentage version
 * in the most recently created deployment that is not the candidate
 * we're about to deploy. Returns `null` when the script has no prior
 * deployments (first deploy of a brand-new package).
 */
const lookup_previous_active_version = async (cf: CloudflareProvider, script_name: string, exclude_version_id: string | null): Promise<Result<string | null, CloudflareError>> => {
	const list = await cf.deployments.list(script_name);
	if (!list.ok) {
		if (list.error.code === "not_found") return ok(null);
		return list;
	}
	const sorted = list.value.slice().sort((a, b) => (a.created_on < b.created_on ? 1 : a.created_on > b.created_on ? -1 : 0));
	for (const deployment of sorted) {
		const candidates = deployment.strategy.versions.filter(v => v.version_id !== exclude_version_id);
		if (candidates.length === 0) continue;
		const best = candidates.slice().sort((a, b) => b.percentage - a.percentage)[0];
		return ok(best.version_id);
	}
	return ok(null);
};

/**
 * Deploy a stage. Sequence:
 *
 * 1. Look up or upload the worker version for this `version_set_id`
 *    (idempotent).
 * 2. For partial-traffic stages, look up the currently-active
 *    predecessor version so the percentage strategy can ramp it down.
 * 3. Build the Cloudflare deployment payload via the pure helper.
 * 4. Create the deployment.
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
		version_result = await upload_version(cf, script_name, version_set_id, identity_vars, bundle.value);
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
