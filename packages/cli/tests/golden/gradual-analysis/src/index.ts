/**
 * gradual-analysis — pipeline-managed Cloudflare Worker scaffold.
 *
 * The entrypoint is a `WorkerEntrypoint` so callers can later bind to
 * named RPC methods rather than HTTP. All Anthropic traffic flows through
 * `env.ANTHROPIC` (a service binding to the vault Worker) — never call
 * `api.anthropic.com` directly from here. All observability flows to
 * `env.PULSE`.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env.ts";

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
