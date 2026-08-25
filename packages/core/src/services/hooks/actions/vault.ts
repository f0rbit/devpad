/**
 * @module core/services/hooks/actions/vault
 *
 * v2.4 (task A3.4) — vault action executor. Calls the `VAULT_GITHUB` service
 * binding (task A3.5's companion PR in `~/dev/vault`) for `github:*` hook
 * actions, passing devpad's caller identity explicitly as an RPC argument —
 * Cloudflare service bindings don't propagate caller env vars, so identity
 * must travel this way (the same pattern every other vault adapter uses).
 *
 * `GitHubVaultBinding` is the contract devpad and vault both implement
 * against — devpad as a caller-side type, vault as its `GitHubVault`
 * WorkerEntrypoint's actual method signatures.
 */

import type { GitHubVaultBinding, VaultCallerIdentity } from "@devpad/schema/bindings";
import type { ActionExecutor, ActionResult } from "../dispatch.js";

export type { GitHubVaultBinding, VaultCallerIdentity as CallerIdentity } from "@devpad/schema/bindings";
export type { VaultRpcResult } from "@devpad/schema/bindings";

export type VaultExecutorDeps = {
	vault_github: GitHubVaultBinding;
	environment: string;
};

const VAULT_CALLER_PACKAGE_ID = "devpad";

const permanent_error_kinds = new Set(["grant_denied", "validation_error", "not_found"]);

export function VaultActionExecutor(deps: VaultExecutorDeps): ActionExecutor {
	return {
		async execute({ action }): Promise<ActionResult> {
			if (action.kind !== "vault") return { ok: false, transient: false, message: "executor/action kind mismatch" };

			const identity: VaultCallerIdentity = { package_id: VAULT_CALLER_PACKAGE_ID, environment: deps.environment };
			const call =
				action.op === "create_release"
					? (input: Record<string, unknown>, id: VaultCallerIdentity) => deps.vault_github.create_release(input, id)
					: action.op === "get_latest_release"
						? (input: Record<string, unknown>, id: VaultCallerIdentity) =>
								deps.vault_github.get_latest_release(input, id)
						: null;
			if (!call) return { ok: false, transient: false, message: `unsupported vault op: ${action.op}` };

			const result = await call(action.args ?? {}, identity);
			if (!result.ok) {
				const permanent = permanent_error_kinds.has(result.error.kind);
				return { ok: false, transient: !permanent, message: result.error.message ?? result.error.kind };
			}
			return { ok: true };
		},
	};
}
