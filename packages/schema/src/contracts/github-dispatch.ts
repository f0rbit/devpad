/**
 * devpad orchestrator → vault: `GitHubVault.dispatch_workflow(input, identity)`.
 *
 * Source of truth: the structural `GitHubVaultBinding` type in
 * `packages/pipelines/src/bindings.ts` (vault's own types are never
 * imported across the security boundary) and its production consumer
 * `packages/pipelines/src/providers/vault-dispatcher.ts`.
 *
 * Identity travels as an explicit RPC argument — CF service bindings do
 * NOT propagate caller env vars. Vault checks the
 * `github:dispatch:<owner/repo>/<workflow-file>` grant for
 * `(identity.package_id, identity.environment)` before touching its
 * GitHub token.
 */
import { z } from "zod";
import { grant_environment } from "./grants-check.js";

export const dispatch_repo = z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/, "repo must be <owner>/<name>");

export const dispatch_workflow_file = z.string().regex(/\.ya?ml$/, "workflow must be a .yml or .yaml file");

export const dispatch_ref = z.string().min(1);

export const dispatch_inputs = z
	.record(z.string().min(1), z.string().max(1000))
	.refine((inputs) => Object.keys(inputs).length <= 10, { message: "at most 10 workflow_dispatch inputs" });

export const dispatch_call_input = z
	.object({
		repo: dispatch_repo,
		workflow: dispatch_workflow_file,
		ref: dispatch_ref,
		inputs: dispatch_inputs,
	})
	.strict();

export type DispatchCallInput = z.infer<typeof dispatch_call_input>;

export const dispatch_identity = z
	.object({
		package_id: z.string().min(1),
		environment: grant_environment,
	})
	.strict();

export type DispatchCallIdentity = z.infer<typeof dispatch_identity>;

/**
 * Mirror of vault's `GitHubUpstreamError` — the GitHub REST failure the
 * adapter saw, wrapped under `upstream_error.cause`.
 */
export const github_upstream_error = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("rate_limited"), status: z.literal(429), message: z.string() }),
	z.object({ kind: z.literal("unauthorized"), status: z.number().int(), message: z.string() }),
	z.object({ kind: z.literal("not_found"), status: z.literal(404), message: z.string() }),
	z.object({ kind: z.literal("validation"), status: z.number().int(), message: z.string() }),
	z.object({ kind: z.literal("internal"), status: z.number().int(), message: z.string() }),
	z.object({ kind: z.literal("network"), message: z.string() }),
	z.object({ kind: z.literal("decode"), message: z.string() }),
]);

/**
 * Mirror of vault's `GitHubVaultError` union — every way the RPC itself
 * can fail. `grant_denied` carries the denied scope so devpad's error
 * mapping can name it in the UI.
 */
export const github_vault_error = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("identity_missing"), message: z.string() }),
	z.object({ kind: z.literal("grant_denied"), scope: z.string().min(1), reason: z.string().optional() }),
	z.object({ kind: z.literal("grant_check_failed"), message: z.string() }),
	z.object({ kind: z.literal("invalid_input"), message: z.string() }),
	z.object({ kind: z.literal("upstream_error"), cause: github_upstream_error }),
]);

export type GitHubVaultWireError = z.infer<typeof github_vault_error>;

export const github_dispatch_success = z.object({
	dispatched: z.literal(true),
	run_id: z.number().int().optional(),
	run_url: z.string().optional(),
});

/**
 * The corpus-`Result` envelope the RPC resolves with —
 * `{ ok: true, value }` or `{ ok: false, error }`.
 */
export const github_dispatch_result = z.union([
	z.object({ ok: z.literal(true), value: github_dispatch_success }),
	z.object({ ok: z.literal(false), error: github_vault_error }),
]);
