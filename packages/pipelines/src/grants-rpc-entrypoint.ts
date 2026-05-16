/**
 * @module pipelines/grants-rpc-entrypoint
 *
 * The Cloudflare Worker shell for the grants RPC. Vault binds to this
 * class via `services[].entrypoint = "PipelinesGrantsEndpoint"`.
 *
 * Kept in its own file because the `cloudflare:workers` import is only
 * resolvable inside a real Worker bundle; isolating it lets
 * `grants-rpc.ts` (the pure service + types) remain importable from
 * bun-native tests.
 */

import type { Database } from "@devpad/schema/database/types";
import type { Result } from "@f0rbit/corpus";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { PipelineEnv } from "./bindings.ts";
import { type CallerIdentity, type GrantCheckResponse, type GrantRpcError, type PipelinesGrantsRPC, PipelinesGrantsService } from "./grants-rpc.ts";

export class PipelinesGrantsEndpoint extends WorkerEntrypoint<PipelineEnv> implements PipelinesGrantsRPC {
	async check(caller: CallerIdentity, scope: string): Promise<Result<GrantCheckResponse, GrantRpcError>> {
		const service = new PipelinesGrantsService(this.env.DB as unknown as Database);
		return service.check(caller, scope);
	}
}
