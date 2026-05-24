/**
 * Grants for anthropic-search.
 *
 * Declares which upstream scopes this Worker is permitted to use in each
 * stage. The pipelines orchestrator's `grants.check(caller, scope)` RPC
 * gates every vault call against this registry — adding a scope here
 * does not auto-approve it, the grant still needs human approval in the
 * grants UI before vault will accept the call.
 *
 * `anthropic:messages` covers the messages API. `internal:pulse:emit` is
 * the observability scope — granted by default on every stage.
 */

export default {
	staging: ["internal:pulse:emit", "anthropic:messages"],
	"pr-preview-*": ["internal:pulse:emit", "anthropic:messages"],
	onebox: ["internal:pulse:emit"],
	wave1: ["internal:pulse:emit"],
	wave2: ["internal:pulse:emit"],
	full: ["internal:pulse:emit"],
	"atomic-prod": ["internal:pulse:emit"],
	production: ["internal:pulse:emit", "anthropic:messages"],
};
