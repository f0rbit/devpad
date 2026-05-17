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
 *
 * Pulse contract (see ~/dev/pulse/packages/schema/src/validation.ts):
 *   POST /e
 *   header X-Pulse-Key: pk_*
 *   body { project_id, events: [{ name: "event", package, environment,
 *            version_id, properties: { ... } }] }
 *
 * `name: "event"` selects the generic custom_event variant; the per-version
 * dimensions (package, environment, version_id) hoist to the top level so
 * pulse's `GET /summary` can group on them. The emitter is fire-and-forget
 * — ingest failures must NEVER block a caller's request.
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

/**
 * Fire-and-forget pulse emit. Skips when project id / ingest key are
 * unconfigured (deploy may legitimately not have pulse wired). Any error
 * during ingest is swallowed — the caller's request must not block on
 * observability.
 *
 * `event_name` is the package-specific event label (lands in
 * `properties.name`). `properties` carries any caller-specific fields.
 */
export const emit_pulse = async (
	env: Env,
	event_name: string,
	properties: Record<string, unknown>,
): Promise<void> => {
	if (env.PULSE_PROJECT_ID === undefined || env.PULSE_INGEST_KEY === undefined) return;
	const identity = read_caller_identity(env);
	try {
		const ingest_key = await env.PULSE_INGEST_KEY.get();
		const body = JSON.stringify({
			project_id: env.PULSE_PROJECT_ID,
			events: [{
				name: "event",
				package: identity.package,
				environment: identity.environment,
				version_id: identity.version_set_id,
				properties: { name: event_name, ...properties },
			}],
		});
		const response = await env.PULSE.fetch(new Request("https://pulse/e", {
			method: "POST",
			headers: { "content-type": "application/json", "X-Pulse-Key": ingest_key },
			body,
		}));
		if (response.status >= 400) {
			console.error(`pulse ingest returned ${response.status}`);
		}
	} catch (cause) {
		console.error("pulse emit failed:", cause);
	}
};

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
