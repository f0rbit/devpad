/**
 * @module core/services/pipelines/rollback
 *
 * Rollback by redeploying the *previous version set*'s worker at 100%.
 * **No `wrangler rollback`** — the orchestrator owns the lifecycle via
 * the `deployments.create` API.
 *
 * The pure helper {@link find_rollback_target} walks the corpus-lineage
 * version-set list and returns the most recent predecessor that
 * successfully deployed. The side-effect wrapper {@link rollback_run}
 * looks up the worker version associated with that target (uploading if
 * missing) and pushes a 100% deployment at the previous version_id.
 */

import type { CloudflareError, CloudflareProvider, WorkerVersion } from "@devpad/pipeline-fakes";
import { err, ok, type Result } from "@f0rbit/corpus";

/**
 * Lineage record used by the rollback target search. The corpus version
 * set lineage exposes more fields; we only need these for the search.
 */
export type VersionSetRef = {
	version_set_id: string;
	deployed_successfully: boolean;
	created_at: string;
};

export type RollbackError = CloudflareError | { code: "no_rollback_target"; message: string } | { code: "no_version_uploaded"; message: string };

export type RollbackResult = {
	previous_version_set_id: string;
	deployment_id: string;
	version_id: string;
};

/**
 * Walk the lineage list (assumed newest-first by `created_at` desc — we
 * sort just in case) and return the most recent predecessor that
 * actually shipped. The current run's own version-set is excluded by
 * `current_version_set_id`.
 *
 * Pure — no IO, no clock, no random.
 */
export const find_rollback_target = (lineage: VersionSetRef[], current_version_set_id: string): Result<VersionSetRef, RollbackError> => {
	const candidates = lineage
		.filter(v => v.version_set_id !== current_version_set_id && v.deployed_successfully)
		.slice()
		.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

	const target = candidates[0];
	if (target === undefined) {
		return err({ code: "no_rollback_target", message: `no deployed predecessor to roll back to from ${current_version_set_id}` });
	}
	return ok(target);
};

const VERSION_KEY = "version_set_id";

const find_version_for = async (cf: CloudflareProvider, script_name: string, version_set_id: string): Promise<Result<WorkerVersion, RollbackError>> => {
	const list = await cf.versions.list(script_name);
	if (!list.ok) return list;
	const match = list.value.find(v => v.annotations?.[VERSION_KEY] === version_set_id);
	if (!match) {
		return err({ code: "no_version_uploaded", message: `no worker version uploaded for ${version_set_id}` });
	}
	return ok(match);
};

/**
 * Push a 100% deployment of `target_version_set_id` against
 * `script_name`. The wrapper calling this is responsible for persisting
 * the resulting pipeline-stage event and pulse emission — this function
 * just talks to Cloudflare.
 */
export const rollback_run = async (cf: CloudflareProvider, input: { script_name: string; target_version_set_id: string }): Promise<Result<RollbackResult, RollbackError>> => {
	const version_result = await find_version_for(cf, input.script_name, input.target_version_set_id);
	if (!version_result.ok) return version_result;
	const version = version_result.value;

	const deployment = await cf.deployments.create({
		script_name: input.script_name,
		strategy: {
			strategy: "percentage",
			versions: [{ version_id: version.id, percentage: 100 }],
		},
	});
	if (!deployment.ok) return deployment;

	return ok({
		previous_version_set_id: input.target_version_set_id,
		deployment_id: deployment.value.id,
		version_id: version.id,
	});
};
