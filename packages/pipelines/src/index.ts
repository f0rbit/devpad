/**
 * @module pipelines/index
 *
 * Worker entry for the pipelines orchestrator.
 *
 * Exports:
 * - `PipelineRunDO` — the Durable Object class wrangler binds to
 * - `default` — the Hono app's `fetch` handler
 *
 * Production wiring of `RunDeps` / `RoutesDeps` from the Worker env
 * lives in {@link ./deps.ts} — see there for the construction graph.
 */

import type { PipelineEnv } from "./bindings.ts";
import { build_routes_deps_from_env, build_run_deps_from_env } from "./deps.ts";
import { make_routes } from "./routes.ts";
import { type DoCtx, make_run_handler, type PipelineRunDOLike, type RunDoServices } from "./run-do.ts";

/**
 * Production Durable Object class. Wrangler binds to this name via
 * `durable_objects.bindings[].class_name = "PipelineRunDO"`. The
 * actual logic is in `make_run_handler` — this is a 6-line shell so
 * the class boundary doesn't leak into tests.
 */
export class PipelineRunDO implements PipelineRunDOLike {
	private readonly handler: ReturnType<typeof make_run_handler>;

	constructor(ctx: DoCtx, env: PipelineEnv) {
		const services: RunDoServices = { deps: build_run_deps_from_env(env) };
		this.handler = make_run_handler(ctx, services);
	}

	fetch(request: Request): Promise<Response> {
		return this.handler.handle(request);
	}

	alarm(): Promise<void> {
		return this.handler.fire_alarm();
	}
}

const app = make_routes(env => build_routes_deps_from_env(env as PipelineEnv));

export default {
	fetch: app.fetch,
};

export type { PipelineEnv } from "./bindings.ts";
export type { DoRouter, DoStub } from "./do-router.ts";
export { make_cf_router } from "./do-router.ts";
export type { CallerIdentity, GrantCheckResponse, GrantRpcError, PipelinesGrantsRPC } from "./grants-rpc.ts";
export { PipelinesGrantsService } from "./grants-rpc.ts";
export { PipelinesGrantsEndpoint } from "./grants-rpc-entrypoint.ts";
export type { AuthError } from "./auth.ts";
export { is_bearer_valid, parse_bearer_header, require_bearer_token } from "./auth.ts";
export type { AuthGate, LineageProvider, ManifestProvider, PulseEmitterLite, RoutesDeps, TemplateResolver } from "./routes.ts";
export { make_routes } from "./routes.ts";
export type { DoCtx, RunDoServices } from "./run-do.ts";
export { make_run_handler } from "./run-do.ts";
export { build_routes_deps_from_env, build_run_deps_from_env } from "./deps.ts";
