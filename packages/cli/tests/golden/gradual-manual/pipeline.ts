/**
 * Pipeline declaration for gradual-manual.
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

import { manual, extendTemplate } from "@devpad/pipeline-templates";

export default extendTemplate({
		rollout: {
			type: "gradual",
			// Override stages here, e.g. { name: "onebox", traffic: 5, bake: "1h" }.
			// Omitted stages keep their defaultGradual values.
			stages: [],
		},
		gates: {
			"staging→onebox": manual(),
			"onebox→wave1": manual(),
			"wave1→wave2": manual(),
			"wave2→full": manual(),
		},
});
