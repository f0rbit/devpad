/**
 * @module pipeline-templates/default-gradual
 *
 * The cautious default rollout shape: four stages between staging and
 * production with progressively higher traffic + bake. The default gate
 * map gates only `staging → onebox` (first prod traffic) as manual; every
 * later transition advances automatically after its bake window.
 *
 * Both values are deeply frozen via `as const` so consumers can compare
 * for identity, but they MUST clone via {@link extendTemplate} before
 * mutating. The DSL handles cloning.
 */

import type { Gate, Rollout, TransitionKey } from "./types.ts";

const MIN = 60_000;

/**
 * Onebox 1% (30m bake) → wave1 10% (1h) → wave2 50% (2h) → full 100% (no bake).
 * Mirrors the architecture spec verbatim. Override via `extendTemplate`.
 */
export const defaultGradual: Rollout = {
	type: "gradual",
	stages: [
		{ name: "onebox", traffic: 1, bake: { ms: 30 * MIN } },
		{ name: "wave1", traffic: 10, bake: { ms: 60 * MIN } },
		{ name: "wave2", traffic: 50, bake: { ms: 120 * MIN } },
		{ name: "full", traffic: 100, bake: { ms: 0 } },
	],
};

/**
 * `staging → onebox` is the only human-gated transition by default.
 * Every other transition is `auto` with `afterBake: true` so the
 * orchestrator waits the bake window of the preceding stage before
 * advancing.
 */
export const defaultGradualGates: Record<TransitionKey, Gate> = {
	"staging→onebox": { type: "manual" },
	"onebox→wave1": { type: "auto", afterBake: true },
	"wave1→wave2": { type: "auto", afterBake: true },
	"wave2→full": { type: "auto", afterBake: true },
};
