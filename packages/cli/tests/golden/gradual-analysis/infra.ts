/**
 * Alchemy infrastructure declaration for gradual-analysis.
 *
 * Do NOT add `wrangler deploy` to CI — the pipeline orchestrator owns
 * promotion. This file only describes the Worker + service bindings;
 * `alchemy run` against this file emits the version, the orchestrator
 * picks it up via the version-set manifest.
 */

import alchemy from "alchemy";
import { Worker } from "alchemy/cloudflare";

const app = await alchemy("gradual-analysis");

const vault = await Worker("vault", {
	name: "vault",
	adopt: true,
	entrypoint: "AnthropicVault",
});

const pulse = await Worker("pulse", {
	name: "pulse",
	adopt: true,
});

export const worker = await Worker("gradual-analysis", {
	name: "gradual-analysis",
	entrypoint: "./src/index.ts",
	bindings: {
		ANTHROPIC: vault,
		PULSE: pulse,
	},
	observability: { enabled: true },
});

await app.finalize();
