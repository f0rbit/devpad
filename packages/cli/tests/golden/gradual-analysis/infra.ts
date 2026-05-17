/**
 * Alchemy infrastructure declaration for gradual-analysis.
 *
 * Do NOT add `wrangler deploy` to CI — the pipeline orchestrator owns
 * promotion. This file only describes the Worker + service bindings;
 * `alchemy run` against this file emits the version, the orchestrator
 * picks it up via the version-set manifest.
 *
 * Platform services (vault, pulse) are singletons — `vault-production`
 * and `pulse-api-production` are the only Workers, regardless of which
 * stage of this package is calling. Stage scoping happens at the
 * `caller.environment` RPC arg (vault grants) and on pulse event tags,
 * not by routing to a different upstream Worker.
 *
 * Pulse observability is OPTIONAL. The emitter no-ops when the project
 * id / ingest key aren't bound, so we only wire them when the operator
 * has set the env vars. Provision both before promoting to prod:
 *   - PULSE_PROJECT_ID  — devpad project id that scopes events
 *   - PULSE_INGEST_KEY  — pk_* public ingest key from pulse's /admin/keys
 * Mirrors the same gate vault uses (see ~/dev/vault/infra.ts).
 */

import alchemy from "alchemy";
import type { Bindings } from "alchemy/cloudflare";
import { Secret, SecretsStore, Worker, WorkerRef } from "alchemy/cloudflare";

const app = await alchemy("gradual-analysis");

const stage = app.stage;
const is_staging = stage === "staging";

const worker_name = is_staging ? "gradual-analysis-staging" : "gradual-analysis";

const bindings: Bindings = {
	ANTHROPIC: WorkerRef({ service: "vault-production" }),
	PULSE: WorkerRef({ service: "pulse-api-production" }),
	ENVIRONMENT: is_staging ? "staging" : "production",
};

const pulse_project_id = process.env.PULSE_PROJECT_ID;
const pulse_ingest_key_value = process.env.PULSE_INGEST_KEY;

if (pulse_project_id !== undefined && pulse_ingest_key_value !== undefined) {
	// Adopt the account-wide default secrets store. CF currently caps
	// accounts at one store; isolation is at the secret-name level.
	const secrets_store = await SecretsStore("gradual-analysis-secrets", {
		name: "default_secrets_store",
		adopt: true,
	});
	const pulse_ingest_key = await Secret("PULSE_INGEST_KEY", {
		name: "PULSE_INGEST_KEY",
		store: secrets_store,
		value: alchemy.secret.env.PULSE_INGEST_KEY,
	});
	bindings.PULSE_PROJECT_ID = pulse_project_id;
	bindings.PULSE_INGEST_KEY = pulse_ingest_key;
}

export const worker = await Worker("gradual-analysis", {
	name: worker_name,
	entrypoint: "./src/index.ts",
	compatibilityDate: "2026-05-17",
	compatibilityFlags: ["nodejs_compat"],
	observability: { enabled: true },
	url: true,
	adopt: true,
	bindings,
});

await app.finalize();
