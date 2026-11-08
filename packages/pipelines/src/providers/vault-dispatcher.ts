/**
 * @module pipelines/providers/vault-dispatcher
 *
 * Production `Dispatcher` for external deploy mode (#155). Backed by
 * vault's `GitHubVault` service binding — vault holds the GitHub token
 * (Secrets Store) and enforces the
 * `github:dispatch:<owner/repo>/<workflow-file>` grant for
 * `(package_id, environment)` before dispatching.
 *
 * Identity travels as an explicit RPC argument (CF service bindings
 * do NOT propagate caller env vars to the callee — cross-repo
 * invariant). The orchestrator is a production singleton and external
 * production dispatches are the only thing it ever dispatches, so the
 * identity environment is pinned to `"production"`.
 *
 * NEVER retries: a failed `workflow_dispatch` may have already started
 * a workflow run upstream — automatic retries would double-dispatch
 * non-idempotent work. Recovery is the human-only `redispatch` route.
 */

import { err, ok, type Result } from "@f0rbit/corpus";
import type { DispatchError, DispatchInput, Dispatcher } from "@devpad/core/services/pipelines";
import type { GitHubUpstreamError, GitHubVaultBinding, GitHubVaultError } from "../bindings";

const map_upstream_error = (cause: GitHubUpstreamError): DispatchError => {
	switch (cause.kind) {
		case "not_found":
			return {
				code: "not_found",
				message: "GitHub returned 404: workflow not found — check external_target.workflow and the token's repo access",
			};
		case "unauthorized":
			return {
				code: "unauthorized",
				message: `GitHub returned ${String(cause.status)}: token rejected or lacks workflow dispatch permission for this repo`,
			};
		case "validation":
			return {
				code: "validation",
				message: `GitHub returned ${String(cause.status)}: ${cause.message} — check external_target.ref and the workflow's workflow_dispatch inputs`,
			};
		case "rate_limited":
			return { code: "internal", message: "GitHub rate limit hit (429) — wait, then redispatch" };
		case "internal":
			return { code: "internal", message: `GitHub returned ${String(cause.status)}: ${cause.message}` };
		case "network":
			return { code: "internal", message: `could not reach GitHub: ${cause.message}` };
		case "decode":
			return { code: "internal", message: `unreadable GitHub response: ${cause.message}` };
	}
};

const map_vault_error = (error: GitHubVaultError): DispatchError => {
	switch (error.kind) {
		case "grant_denied":
			return {
				code: "unauthorized",
				message: `vault denied scope ${error.scope}${error.reason ? `: ${error.reason}` : ""} — grant github:dispatch for this package`,
			};
		case "grant_check_failed":
			return { code: "internal", message: `vault grant check failed: ${error.message}` };
		case "identity_missing":
			return { code: "internal", message: `vault rejected caller identity: ${error.message}` };
		case "invalid_input":
			return { code: "validation", message: error.message };
		case "upstream_error":
			return map_upstream_error(error.cause);
	}
};

export const make_vault_dispatcher = (vault: GitHubVaultBinding): Dispatcher => ({
	dispatch: async (input: DispatchInput): Promise<Result<void, DispatchError>> => {
		const result = await vault.dispatch_workflow(
			{ repo: input.repo, workflow: input.workflow, ref: input.ref, inputs: input.inputs },
			{ package_id: input.package_id, environment: "production" },
		);
		if (!result.ok) return err(map_vault_error(result.error));
		return ok(undefined);
	},
});
