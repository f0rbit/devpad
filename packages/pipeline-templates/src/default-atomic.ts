/**
 * @module pipeline-templates/default-atomic
 *
 * The single-shot rollout shape: one transition (`staging → atomic-prod`)
 * that lands at 100% via Cloudflare's single-version `deployments.create`.
 * This is the shape used by low-importance services that opt out of the
 * gradual waves, and the shape the discriminator forces when DO migrations
 * or unaffinitised assets make percentage rollouts unsafe.
 */

import type { Gate, Rollout, TransitionKey } from "./types";

export const defaultAtomic: Rollout = { type: "atomic" };

/**
 * The only transition in an atomic rollout is manual by default — atomic
 * = irreversible landing at 100%, so a human approves before we ship. To
 * skip the approval, override to `{ type: "auto" }` via `extendTemplate`.
 */
export const defaultAtomicGates: Record<TransitionKey, Gate> = {
	"staging→atomic-prod": { type: "manual" },
};
