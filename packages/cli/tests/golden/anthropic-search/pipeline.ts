/**
 * Pipeline declaration for anthropic-search.
 *
 * `extendTemplate` merges these overrides on top of the chosen default
 * (gradual or atomic). Returns a {@link Result} — unknown stage names or
 * transition keys surface as typed errors at template-build time rather
 * than at deploy time.
 *
 * Override examples (uncomment and adapt):
 *
 *   // Stretch the first bake window without touching others:
 *   //   stages: [{ name: "onebox", bake: "1h" }]
 *
 *   // Switch a single transition to manual approval:
 *   //   gates: { "wave1→wave2": manual() }
 *
 *   // Promote without waiting on bake:
 *   //   gates: { "onebox→wave1": auto({ afterBake: false }) }
 */

import { auto, extendTemplate } from "@devpad/pipeline-templates";

export default extendTemplate({
		rollout: { type: "atomic" },
		gates: {
			"staging→atomic-prod": auto(),
		},
});
