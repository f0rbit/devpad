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

import { WorkerEntrypoint } from "cloudflare:workers";
import { createD1Database } from "@devpad/schema/database/d1";
import type { Result } from "@f0rbit/corpus";
import type { PipelineEnv } from "./bindings.ts";
import {
	type CallerIdentity,
	type GrantCheckResponse,
	type GrantRpcError,
	type PipelinesGrantsRPC,
	PipelinesGrantsService,
} from "./grants-rpc.ts";

export class PipelinesGrantsEndpoint extends WorkerEntrypoint<PipelineEnv> implements PipelinesGrantsRPC {
	private service_cached: PipelinesGrantsService | null = null;

	private get service(): PipelinesGrantsService {
		if (this.service_cached !== null) return this.service_cached;
		const db = createD1Database(this.env.DB);
		this.service_cached = new PipelinesGrantsService(db);
		return this.service_cached;
	}

	async check(caller: CallerIdentity, scope: string): Promise<Result<GrantCheckResponse, GrantRpcError>> {
		return this.service.check(caller, scope);
	}
}
