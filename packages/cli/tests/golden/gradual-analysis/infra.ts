/**
 * Alchemy infrastructure declaration for gradual-analysis.
 *
 * Do NOT add `wrangler deploy` to CI — the pipeline orchestrator owns
 * promotion. This file only describes the Worker + service bindings;
 * `alchemy run` against this file emits the version, the orchestrator
 * picks it up via the version-set manifest.
 *
 * Service binding targets are stage-suffixed: `vault-staging` /
 * `vault-production` and `pulse-api-staging` / `pulse-api-production`.
 */

import alchemy from "alchemy";
import { Worker, WorkerRef } from "alchemy/cloudflare";

const app = await alchemy("gradual-analysis");

const stage = app.stage;
const is_staging = stage === "staging";

const worker_name = is_staging ? "gradual-analysis-staging" : "gradual-analysis";
const vault_service = is_staging ? "vault-staging" : "vault-production";
const pulse_service = is_staging ? "pulse-api-staging" : "pulse-api-production";

export const worker = await Worker("gradual-analysis", {
	name: worker_name,
	entrypoint: "./src/index.ts",
	compatibilityDate: "2026-05-17",
	compatibilityFlags: ["nodejs_compat"],
	observability: { enabled: true },
	url: true,
	adopt: true,
	bindings: {
		ANTHROPIC: WorkerRef({ service: vault_service }),
		PULSE: WorkerRef({ service: pulse_service }),
		ENVIRONMENT: is_staging ? "staging" : "production",
	},
});

await app.finalize();
