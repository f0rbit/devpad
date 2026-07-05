/**
 * @module pipelines/grants-rpc
 *
 * Typed RPC contract + pure service that the vault Worker consumes to
 * check whether a given caller is authorised for a given scope. This is
 * the ONLY channel through which the vault reads pipeline-grant state
 * — the vault Worker never touches devpad's D1 directly.
 *
 * The Cloudflare-runtime shell (`PipelinesGrantsEndpoint extends
 * WorkerEntrypoint`) lives in `grants-rpc-entrypoint.ts` to keep this
 * file usable from `bun test` (the `cloudflare:workers` import is only
 * resolvable inside a real Worker bundle).
 *
 * Contract published below as `PipelinesGrantsRPC` so vault can declare
 * a structural type without a workspace import.
 */

import { check_grant } from "@devpad/core/services/pipelines";
import type { Database } from "@devpad/schema/database/types";
import { err, ok, type Result } from "@f0rbit/corpus";

export type CallerIdentity = {
	package_id: string;
	environment: string;
	version_set_id: string;
};

export type GrantCheckResponse = {
	granted: boolean;
	reason?: string;
};

export type GrantRpcError = { kind: "invalid_caller"; message: string } | { kind: "store_error"; message: string };

/**
 * The contract the vault consumes. Re-declared structurally on the
 * vault side so vault doesn't need a workspace import on
 * `@devpad/pipelines`.
 */
export type PipelinesGrantsRPC = {
	check(caller: CallerIdentity, scope: string): Promise<Result<GrantCheckResponse, GrantRpcError>>;
};

const validate_caller = (caller: CallerIdentity): Result<void, GrantRpcError> => {
	if (typeof caller.package_id !== "string" || caller.package_id.length === 0)
		return err({ kind: "invalid_caller", message: "caller.package_id missing" });
	if (typeof caller.environment !== "string" || caller.environment.length === 0)
		return err({ kind: "invalid_caller", message: "caller.environment missing" });
	if (typeof caller.version_set_id !== "string" || caller.version_set_id.length === 0)
		return err({ kind: "invalid_caller", message: "caller.version_set_id missing" });
	return ok(undefined);
};

const validate_scope = (scope: string): Result<void, GrantRpcError> => {
	if (typeof scope !== "string" || scope.length === 0) return err({ kind: "invalid_caller", message: "scope missing" });
	return ok(undefined);
};

/**
 * Pure service-layer implementation (no Worker runtime required). Tests
 * use this directly with a bun-sqlite in-memory `Database`; the
 * production Worker wraps it in `PipelinesGrantsEndpoint`.
 */
export class PipelinesGrantsService implements PipelinesGrantsRPC {
	constructor(private readonly db: Database) {}

	async check(caller: CallerIdentity, scope: string): Promise<Result<GrantCheckResponse, GrantRpcError>> {
		const caller_check = validate_caller(caller);
		if (!caller_check.ok) return caller_check;
		const scope_check = validate_scope(scope);
		if (!scope_check.ok) return scope_check;

		const verdict = await check_grant(this.db, caller.package_id, caller.environment, scope);
		if (!verdict.ok) return err({ kind: "store_error", message: verdict.error.kind });
		return ok({
			granted: verdict.value,
			reason: verdict.value ? undefined : `No approved grant for ${scope} at ${caller.environment}`,
		});
	}
}
