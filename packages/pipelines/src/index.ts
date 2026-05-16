/**
 * @module pipelines/index
 *
 * Worker entry for the pipelines orchestrator.
 *
 * Exports:
 * - `PipelineRunDO` — the Durable Object class wrangler binds to
 * - `default` — the Hono app's `fetch` handler
 *
 * The production wiring of `RunDeps` from the Worker env happens here
 * (it depends on D1, R2 corpus, a vault binding, etc.). The DO class
 * defers all logic to `make_run_handler`.
 */

import type { RunDeps } from "@devpad/core/services/pipelines";
import type { PipelineEnv } from "./bindings.ts";
import { make_routes, type RoutesDeps } from "./routes.ts";
import { type DoCtx, make_run_handler, type PipelineRunDOLike, type RunDoServices } from "./run-do.ts";

/**
 * Factory the parent Worker uses to build the DO instance. In
 * production we wire env → RunDeps here. Phase 2 will fill this in;
 * Phase 1 leaves it as a deliberately-failing stub so the Worker
 * deploys but any traffic surfaces a clear error.
 */
const build_run_deps_from_env = (_env: PipelineEnv): RunDeps => {
	throw new Error("build_run_deps_from_env: not implemented in Phase 1 — wire D1 + Cloudflare provider + pulse + approvals in Phase 2 deploy");
};

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

/**
 * Build the routes deps from the Worker env. Like
 * {@link build_run_deps_from_env}, the D1/R2/lineage wiring is
 * deferred to Phase 2's deploy. The routes layer accepts a factory
 * so tests can inject their own deps.
 */
const build_routes_deps_from_env = (_env: PipelineEnv): RoutesDeps => {
	throw new Error("build_routes_deps_from_env: not implemented in Phase 1 — wire D1 + manifest provider + template resolver + lineage provider in Phase 2 deploy");
};

const app = make_routes(env => build_routes_deps_from_env(env as PipelineEnv));

export default {
	fetch: app.fetch,
};

export { make_routes } from "./routes.ts";
export { make_run_handler } from "./run-do.ts";
export { make_cf_router } from "./do-router.ts";
export type { DoCtx, RunDoServices } from "./run-do.ts";
export type { DoRouter, DoStub } from "./do-router.ts";
export type { LineageProvider, ManifestProvider, RoutesDeps, TemplateResolver } from "./routes.ts";
export type { PipelineEnv } from "./bindings.ts";
