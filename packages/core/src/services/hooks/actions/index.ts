import type { ActionExecutor, ActionResult } from "../dispatch.js";

export { PipelineActionExecutor, type PipelineExecutorDeps } from "./pipeline.js";
export { type CallerIdentity, type GitHubVaultBinding, VaultActionExecutor, type VaultExecutorDeps } from "./vault.js";
export { hmac_sha256_hex, WebhookActionExecutor, type WebhookExecutorDeps, webhook_payload } from "./webhook.js";

/**
 * Composes the three action executors into one, dispatching on
 * `action.kind`. A kind with no configured executor (e.g. `vault` before
 * `VAULT_GITHUB` is wired up) is a permanent failure, not a retry loop — the
 * hook config itself is what's wrong, not a transient upstream blip.
 */
export function compose_executors(executors: {
	webhook?: ActionExecutor;
	pipeline?: ActionExecutor;
	vault?: ActionExecutor;
}): ActionExecutor {
	return {
		async execute(input): Promise<ActionResult> {
			const executor = executors[input.action.kind];
			if (!executor)
				return {
					ok: false,
					transient: false,
					message: `no executor configured for action kind '${input.action.kind}'`,
				};
			return executor.execute(input);
		},
	};
}
