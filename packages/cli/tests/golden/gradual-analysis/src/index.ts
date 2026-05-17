/**
 * gradual-analysis — pipeline-managed Cloudflare Worker scaffold.
 *
 * The entrypoint is a `WorkerEntrypoint` so callers can later bind to
 * named RPC methods rather than HTTP. All Anthropic traffic flows through
 * `env.ANTHROPIC` (a service binding to the vault Worker) — never call
 * `api.anthropic.com` directly from here. All observability flows to
 * `env.PULSE`.
 *
 * When you call vault, pass `read_caller_identity(env)` as the second
 * arg — CF service bindings don't propagate the caller's env vars to
 * the callee, so identity must travel as an explicit RPC argument:
 *
 *     const result = await env.ANTHROPIC.messages.create(
 *         { model: "...", messages: [...] },
 *         read_caller_identity(env),
 *     );
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type { CallerIdentity, Env } from "./env.ts";

/**
 * Read the caller identity baked in by the pipeline orchestrator.
 * Falls back to "unknown" so a misconfigured deploy surfaces as a
 * vault-side `grant_denied`, not a runtime crash here.
 */
export const read_caller_identity = (env: Env): CallerIdentity => ({
	package: env.CALLER_PACKAGE ?? "unknown",
	environment: env.CALLER_ENV ?? "unknown",
	version_set_id: env.CALLER_VERSION_SET_ID ?? "unknown",
});

export class GradualAnalysisWorker extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return Response.json({ status: "ok", service: "gradual-analysis" });
		}
		if (url.pathname === "/version") {
			return Response.json({ name: "gradual-analysis", version: "0.0.1" });
		}
		return new Response("Not Found", { status: 404 });
	}
}

export default GradualAnalysisWorker;
